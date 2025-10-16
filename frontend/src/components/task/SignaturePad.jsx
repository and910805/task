import { useEffect, useRef, useState } from 'react';

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 200;

const SignaturePad = ({ onSubmit, disabled }) => {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#222';
  }, []);

  const getPosition = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (event.touches && event.touches[0]) {
      return {
        x: event.touches[0].clientX - rect.left,
        y: event.touches[0].clientY - rect.top,
      };
    }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleStart = (event) => {
    if (disabled) return;
    drawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPosition(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    event.preventDefault();
  };

  const handleMove = (event) => {
    if (!drawingRef.current || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPosition(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
    event.preventDefault();
  };

  const handleEnd = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.preventDefault();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    setHasStroke(false);
  };

  const handleSubmit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSubmit?.(dataUrl);
    clear();
  };

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        className="signature-canvas"
      />
      <div className="signature-actions">
        <button type="button" onClick={clear}>
          清除
        </button>
        <button type="button" onClick={handleSubmit} disabled={!hasStroke}>
          送出簽名
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;
