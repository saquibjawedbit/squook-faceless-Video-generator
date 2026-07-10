import Box from '../lib/Box.jsx';

// Ported from VideoTile.dc.html. The Design Composer <image-slot> becomes a
// styled placeholder (no real thumbnail is bundled with the export).
export default function VideoTile({ prompt, meta }) {
  return (
    <Box
      s="position:relative;height:100%;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.09);background:#141419;transition:transform .2s, border-color .2s"
      sh="transform:translateY(-4px);border-color:rgba(255,255,255,0.22)"
    >
      {/* placeholder for the video thumbnail */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 90% at 30% 20%, color-mix(in oklab, var(--accent, #FF5A2D) 18%, #141419), #101014 70%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 32%, transparent 55%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          pointerEvents: 'none',
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 11,
          color: 'rgba(255,255,255,0.85)',
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          padding: '4px 8px',
          borderRadius: 6,
        }}
      >
        {meta}
      </div>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          pointerEvents: 'none',
          width: 54,
          height: 54,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 0,
            height: 0,
            borderLeft: '14px solid rgba(255,255,255,0.92)',
            borderTop: '9px solid transparent',
            borderBottom: '9px solid transparent',
            marginLeft: 4,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            color: 'var(--accent, #FF5A2D)',
          }}
        >
          PROMPT
        </span>
        <span
          style={{
            fontSize: 13.5,
            lineHeight: 1.45,
            color: 'rgba(255,255,255,0.88)',
          }}
        >
          “{prompt}”
        </span>
      </div>
    </Box>
  );
}
