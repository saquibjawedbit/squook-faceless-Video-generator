import os
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

llm = LLM(
    model=f"ollama/{os.getenv('OLLAMA_MODEL', 'gpt-oss:120b-cloud')}",
    base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
)


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
