import {useEffect, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import {Lottie, LottieAnimationData} from '@remotion/lottie';
import {asset} from '../ir';

export const LottieLayer: React.FC<{src: string; loop: boolean}> = ({src, loop}) => {
  const [handle] = useState(() => delayRender(`loading lottie ${src}`));
  const [data, setData] = useState<LottieAnimationData | null>(null);

  useEffect(() => {
    fetch(asset(src))
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((err) => cancelRender(err));
  }, [handle, src]);

  if (!data) return null;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{width: '55%', height: '70%'}}>
        <Lottie
          animationData={data}
          loop={loop}
          style={{width: '100%', height: '100%'}}
        />
      </div>
    </AbsoluteFill>
  );
};
