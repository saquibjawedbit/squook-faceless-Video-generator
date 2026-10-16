import Atmosphere from './components/Atmosphere.jsx';
import Landing from './pages/Landing.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import SquookHome from './pages/SquookHome.jsx';
import SquookEditor from './pages/SquookEditor.jsx';
import WatchVideo from './pages/WatchVideo.jsx';
import FastVideo from './pages/FastVideo.jsx';
import ShareVideo from './pages/ShareVideo.jsx';
import AuthGate from './components/AuthGate.jsx';
import { useRoute, currentQuery } from './lib/router.js';

export default function App() {
  const route = useRoute();

  // The editor is a self-contained, full-viewport surface with its own
  // vignette + grain overlays, so it renders without the site Atmosphere.
  if (route === 'editor') return <AuthGate><SquookEditor /></AuthGate>;
  // Public share page for a video made for a prospect: no sign-in.
  if (route.startsWith('v/')) return <ShareVideo />;
  // Fast mode is a light, full-viewport studio of its own.
  if (route === 'fast') return <AuthGate><FastVideo key={currentQuery().get('id') || 'new'} /></AuthGate>;

  let page;
  if (route === 'pricing') page = <Pricing />;
  else if (route === 'about') page = <About />;
  // `#/app` (the marketing "Start free" CTA) lands on the logged-in home /
  // composer; generating or opening anything from there routes to #/editor.
  else if (route === 'app') page = <AuthGate><SquookHome /></AuthGate>;
  // Landing-page videos (HyperFrames) open here — no editable timeline.
  else if (route === 'watch') page = <AuthGate><WatchVideo /></AuthGate>;
  else page = <Landing />;

  return (
    <>
      <Atmosphere />
      {page}
    </>
  );
}
