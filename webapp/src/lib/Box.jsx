import { useState } from 'react';
import { merge } from './css.js';

// A drop-in element that reproduces Design Composer's `style` + `style-hover`
// + `style-focus` attributes. Pass the CSS strings straight from the export:
//   <Box t="a" s="color:red" sh="color:white" href="#">Link</Box>
// `s` = base style, `sh` = hover overlay, `sf` = focus overlay, `t` = tag name.
export default function Box({ t = 'div', s, sh, sf, style, children, ...rest }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const Tag = t;

  const merged = merge(s, hover && sh, focus && sf, style);

  const handlers = {};
  if (sh) {
    handlers.onMouseEnter = (e) => { setHover(true); rest.onMouseEnter?.(e); };
    handlers.onMouseLeave = (e) => { setHover(false); rest.onMouseLeave?.(e); };
  }
  if (sf) {
    handlers.onFocus = (e) => { setFocus(true); rest.onFocus?.(e); };
    handlers.onBlur = (e) => { setFocus(false); rest.onBlur?.(e); };
  }

  return (
    <Tag style={merged} {...rest} {...handlers}>
      {children}
    </Tag>
  );
}
