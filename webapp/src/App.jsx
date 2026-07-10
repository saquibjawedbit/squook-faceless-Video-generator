import Atmosphere from './components/Atmosphere.jsx';
import Landing from './pages/Landing.jsx';
import Pricing from './pages/Pricing.jsx';
import About from './pages/About.jsx';
import SquookHome from './pages/SquookHome.jsx';
import SquookEditor from './pages/SquookEditor.jsx';
import { useRoute } from './lib/router.js';

export default function App() {
  const route = useRoute();

  // The editor is a self-contained, full-viewport surface with its own
  // vignette + grain overlays, so it renders without the site Atmosphere.
  if (route === 'editor') return <SquookEditor />;

  let page;
  if (route === 'pricing') page = <Pricing />;
  else if (route === 'about') page = <About />;
  // `#/app` (the marketing "Start free" CTA) lands on the logged-in home /
  // composer; generating or opening anything from there routes to #/editor.
  else if (route === 'app') page = <SquookHome />;
  else page = <Landing />;

  return (
    <>
      <Atmosphere />
      {page}
    </>
  );
}
