import json
import os
import re
from typing import Literal

from crewai import Agent, Crew, LLM, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai.agents.agent_builder.base_agent import BaseAgent
from pydantic import BaseModel, Field


class ScriptMetadata(BaseModel):
    title: str
    prompt: str
    total_duration_seconds: int
    scene_count: int


class MusicBrief(BaseModel):
    """The Director's call on the background music: whether the video wants any,
    a one-word mood, and a short search-friendly description of the track. The
    Asset stage uses this to fetch a real track (or synthesise a bed)."""
    needed: bool = True
    mood: str = ""          # e.g. "uplifting", "tense", "calm", "energetic"
    description: str = ""   # e.g. "upbeat corporate synth, light percussion"


class Scene(BaseModel):
    index: int
    duration_seconds: int
    visual: str
    on_screen_text: str
    narration: str


class DirectionScript(BaseModel):
    metadata: ScriptMetadata
    scenes: list[Scene]
    music: MusicBrief = Field(default_factory=MusicBrief)


class AssetQuery(BaseModel):
    scene_index: int
    media_type: Literal["photo", "video", "graphic", "lottie", "upload"]
    query: str


class AssetPlan(BaseModel):
    assets: list[AssetQuery]

def _make_pipeline_llm(ollama_env: str, ollama_default: str,
                       compat_env: str, compat_default: str) -> LLM:
    """Main/fast pipeline LLM. LLM_PROVIDER routes:

      ollama (default)      -> local Ollama daemon; model from OLLAMA_MODEL /
                               FAST_LLM_MODEL, endpoint from OLLAMA_BASE_URL.
      openai-compat | groq  -> any OpenAI-compatible endpoint via LLM_BASE_URL
                               + LLM_API_KEY; model from LLM_MODEL /
                               LLM_FAST_MODEL, passed VERBATIM (Groq's id for
                               gpt-oss-120b literally is "openai/gpt-oss-120b").

    The compat path exists for headless runs (GitHub Actions daily automation)
    where no Ollama daemon is available; Groq's free tier serves the same
    gpt-oss models this pipeline was tuned on."""
    provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if provider in ("openai-compat", "openai_compat", "groq"):
        # Same shape as the Cloudflare design-LLM path below: explicit
        # `provider` skips CrewAI's model-catalog check, and max_tokens guards
        # against endpoint defaults truncating multi-scene JSON.
        return LLM(
            model=os.getenv(compat_env, compat_default).strip(),
            provider="openai",
            base_url=os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").strip(),
            api_key=os.getenv("LLM_API_KEY", "").strip(),
            max_tokens=8192,
        )
    return LLM(
        model=f"ollama/{os.getenv(ollama_env, ollama_default)}",
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
    )


llm = _make_pipeline_llm("OLLAMA_MODEL", "gpt-oss:120b-cloud",
                         "LLM_MODEL", "openai/gpt-oss-120b")

# Small model for the mechanical structured-output steps — intent inference,
# render-treatment picks, JSON repair — where the 120B writer is overkill and
# its latency dominates the run. Set FAST_LLM_MODEL (or LLM_FAST_MODEL in
# openai-compat mode) to change it, or to the main model's name to disable
# the split.
fast_llm = _make_pipeline_llm("FAST_LLM_MODEL", "gpt-oss:20b-cloud",
                              "LLM_FAST_MODEL", "openai/gpt-oss-20b")


def _make_design_llm():
    """LLM for the design-critical steps (art direction + graphic design).

    Routing (DESIGN_LLM_PROVIDER):
      claude|anthropic -> Claude              (needs ANTHROPIC_API_KEY)
      openai           -> OpenAI              (needs OPENAI_API_KEY)
      cloudflare       -> Cloudflare Workers AI via its OpenAI-compatible
                          endpoint (needs CLOUDFLARE_ACCOUNT_ID +
                          CLOUDFLARE_API_TOKEN; default model
                          @cf/meta/llama-3.3-70b-instruct-fp8-fast)
      local|ollama     -> the local Ollama model
      unset            -> auto: Claude, else OpenAI, else Cloudflare, else
                          local — first provider whose credentials exist.
    Auto-detection exists because the local model is a poor visual designer:
    its free-form vector compositions come out malformed (sentence dumps,
    off-frame labels, zero-size shapes). If stronger credentials are already
    in the environment, design quality should use them. DESIGN_LLM_MODEL
    overrides the model id for any cloud provider.

    Returns (llm, is_strong). is_strong gates capabilities only a frontier
    model handles well — most importantly free-form 'custom' vector
    compositions, which the local model reliably botches."""
    def real_key(name: str) -> bool:
        # Same placeholder guard as tools/tts.py — a template .env ships with
        # literal "YOUR_API_KEY", which must read as "no key".
        key = os.getenv(name, "").strip()
        return bool(key) and key != "YOUR_API_KEY"

    provider = os.getenv("DESIGN_LLM_PROVIDER", "").strip().lower()
    if not provider:
        if real_key("ANTHROPIC_API_KEY"):
            provider = "claude"
        elif real_key("OPENAI_API_KEY"):
            provider = "openai"
        elif real_key("CLOUDFLARE_API_TOKEN") and os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip():
            provider = "cloudflare"
        else:
            provider = "local"
    if provider in ("claude", "anthropic"):
        model = os.getenv("DESIGN_LLM_MODEL", "anthropic/claude-opus-4-8")
        if not real_key("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "DESIGN_LLM_PROVIDER=claude requires ANTHROPIC_API_KEY to be set."
            )
        try:
            # CrewAI's native Anthropic provider (uses the official anthropic SDK);
            # api_key is read from ANTHROPIC_API_KEY, no base_url needed.
            print(f"Design steps routed to {model}")
            return LLM(model=model), True
        except ImportError as e:
            raise RuntimeError(
                "DESIGN_LLM_PROVIDER=claude needs the Anthropic provider. "
                'Install it with:  uv add "crewai[anthropic]"  (or: pip install anthropic). '
                f"Original error: {e}"
            ) from e
    if provider == "openai":
        if not real_key("OPENAI_API_KEY"):
            raise RuntimeError(
                "DESIGN_LLM_PROVIDER=openai requires a real OPENAI_API_KEY "
                "(yours is the 'YOUR_API_KEY' placeholder)."
            )
        model = os.getenv("DESIGN_LLM_MODEL", "openai/gpt-4o")
        print(f"Design steps routed to {model}")
        return LLM(model=model), True
    if provider == "cloudflare":
        account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        if not (account and real_key("CLOUDFLARE_API_TOKEN")):
            raise RuntimeError(
                "DESIGN_LLM_PROVIDER=cloudflare requires CLOUDFLARE_ACCOUNT_ID "
                "and CLOUDFLARE_API_TOKEN (Workers AI permission) to be set."
            )
        model = os.getenv("DESIGN_LLM_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast")
        print(f"Design steps routed to Cloudflare Workers AI: {model}")
        # Workers AI speaks the OpenAI chat protocol at /ai/v1 — use the native
        # OpenAI provider pointed at Cloudflare's endpoint. The explicit
        # `provider` kwarg skips CrewAI's model-catalog check, which doesn't
        # know @cf/... ids.
        # max_tokens matters: Workers AI defaults to ~256 output tokens, which
        # truncates multi-scene design JSON mid-object (verified: 8192 accepted).
        return LLM(
            model=model.removeprefix("openai/"),
            provider="openai",
            base_url=f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
            api_key=os.getenv("CLOUDFLARE_API_TOKEN").strip(),
            max_tokens=8192,
        ), True
    if provider not in ("local", "ollama"):
        print(f"Unknown DESIGN_LLM_PROVIDER={provider!r}; using the local model")
    return llm, False


# Design steps use this. DESIGN_LLM_IS_STRONG tells downstream code whether the
# designer is a frontier model (custom vector art allowed) or the local one
# (templates only — its freehand drawings are what made videos look broken).
design_llm, DESIGN_LLM_IS_STRONG = _make_design_llm()


def _research_tools() -> list:
    """Web search for the Researcher — opt-in via RESEARCH_WEB=true plus a
    SERPER_API_KEY (free tier at https://serper.dev). Off by default: every
    tool call adds a full LLM round-trip, ~1-3 min per run on the big model,
    so it's worth paying only for topics that need current facts."""
    if os.getenv("RESEARCH_WEB", "").strip().lower() != "true":
        return []
    if not os.getenv("SERPER_API_KEY"):
        print("RESEARCH_WEB=true but SERPER_API_KEY is not set; researcher stays offline")
        return []
    from crewai_tools import SerperDevTool

    return [SerperDevTool(n_results=5)]


def repair_direction_script(raw: str) -> DirectionScript | None:
    """Salvage a directing output that failed pydantic validation with one
    cheap "fix this JSON" call, instead of re-running the whole 4-task crew.
    Returns None when the raw text is beyond repair."""
    if not (raw or "").strip():
        return None
    schema = json.dumps(DirectionScript.model_json_schema())
    ask = (
        "The JSON below is meant to match this schema but is malformed or "
        "incomplete. Return the corrected JSON — RAW JSON ONLY, no markdown "
        "fences, no commentary. Keep every scene's content; only fix "
        "structure, types, and missing required fields (invent nothing "
        "beyond sensible defaults).\n"
        f"Schema:\n{schema}\n\n"
        f"JSON to fix:\n{raw[:20000]}"
    )
    try:
        text = str(fast_llm.call(ask)).strip()
        fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()
        return DirectionScript(**json.loads(text))
    except Exception as e:
        print(f"Direction-script repair failed ({e})")
        return None


@CrewBase
class ContentCrew():
    """Researcher -> Writer -> Director content crew"""

    agents: list[BaseAgent]
    tasks: list[Task]

    @agent
    def researcher(self) -> Agent:
        return Agent(
            config=self.agents_config['researcher'], # type: ignore[index]
            llm=llm,
            tools=_research_tools(),
            verbose=True
        )

    @agent
    def writer(self) -> Agent:
        return Agent(
            config=self.agents_config['writer'], # type: ignore[index]
            llm=llm,
            verbose=True
        )

    @agent
    def director(self) -> Agent:
        return Agent(
            config=self.agents_config['director'], # type: ignore[index]
            llm=llm,
            verbose=True
        )

    @agent
    def asset_curator(self) -> Agent:
        return Agent(
            config=self.agents_config['asset_curator'], # type: ignore[index]
            llm=llm,
            verbose=True
        )

    @task
    def research_task(self) -> Task:
        return Task(
            config=self.tasks_config['research_task'], # type: ignore[index]
        )

    @task
    def writing_task(self) -> Task:
        return Task(
            config=self.tasks_config['writing_task'], # type: ignore[index]
            context=[self.research_task()],
        )

    @task
    def directing_task(self) -> Task:
        return Task(
            config=self.tasks_config['directing_task'], # type: ignore[index]
            context=[self.writing_task()],
            output_pydantic=DirectionScript,
            output_file='output/direction_script.json'
        )

    @task
    def asset_task(self) -> Task:
        return Task(
            config=self.tasks_config['asset_task'], # type: ignore[index]
            context=[self.directing_task()],
            output_pydantic=AssetPlan,
        )

    @crew
    def crew(self) -> Crew:
        """Creates the ContentCrew crew"""
        import time

        clock = {"last": time.monotonic()}

        def _timed(task_output):
            now = time.monotonic()
            print(f"⏱ task '{task_output.name or task_output.description[:30]}' took {now - clock['last']:.0f}s")
            clock["last"] = now

        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
            task_callback=_timed,
        )
