import { useEffect, useRef, useState } from 'react';
import { AsciiOceanEngine } from './AsciiOceanEngine';
import './AsciiSharksDemo.css';

export default function AsciiSharksDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AsciiOceanEngine | null>(null);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [error, setError] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ASCII Ocean · 字符海洋';
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: AsciiOceanEngine | null = null;
    try {
      engine = new AsciiOceanEngine(canvas, setPaused);
      engineRef.current = engine;
    } catch {
      setError(true);
    }
    return () => {
      engine?.destroy();
      engineRef.current = null;
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="ascii-demo" lang="zh-CN" data-paused={paused}>
      <canvas ref={canvasRef} className="ascii-demo__canvas" role="img" aria-label="三种 ASCII 鲨鱼在字符海洋中摆尾游动，鱼群遇到鲨鱼或光标时散开。点击水面可以制造涟漪。">
        你的浏览器需要支持 Canvas 才能展示这片字符海洋。
      </canvas>
      <div className="ascii-demo__shade" aria-hidden="true" />
      <header className="ascii-demo__header">
        <a className="ascii-demo__back" href="/" aria-label="返回 LINEPOOL 首页">← LINEPOOL</a>
        <a className="ascii-demo__source" href="https://github.com/stackedlol/ascii-sharks" target="_blank" rel="noreferrer">灵感来自 stackedlol <span aria-hidden="true">↗</span></a>
      </header>
      <section className="ascii-demo__intro" aria-labelledby="ascii-demo-title">
        <p className="ascii-demo__eyebrow">一片由字符组成的海</p>
        <h1 id="ascii-demo-title" aria-label="ASCII Ocean">ASCII<span>OCEAN</span><span className="ascii-demo__period">.</span></h1>
        <p className="ascii-demo__copy">移动光标，鱼群会为你让路。<br />轻点水面，让平静泛起涟漪。</p>
      </section>
      {error && <p className="ascii-demo__error" role="alert">这个浏览器暂时无法绘制海洋。请使用支持 Canvas 的浏览器打开。</p>}
      <footer className="ascii-demo__footer">
        <div className="ascii-demo__species" aria-label="海洋中的鲨鱼种类">
          <span>01 <b>礁鲨</b></span><span>02 <b>双髻鲨</b></span><span>03 <b>长尾鲨</b></span>
        </div>
        <div className="ascii-demo__controls">
          <span className="ascii-demo__status" role="status"><i aria-hidden="true" />{error ? '无法绘制' : paused ? '水面已静止' : '正在游动'}</span>
          <button type="button" className="ascii-demo__pause" onClick={() => engineRef.current?.togglePause()} disabled={error} aria-pressed={paused}>{paused ? '播放动画' : '暂停动画'}</button>
          <button type="button" className="ascii-demo__disturb" onClick={() => engineRef.current?.disturb()} disabled={paused || error}>拨动水面 <span aria-hidden="true">↗</span></button>
        </div>
      </footer>
    </main>
  );
}
