import { useEffect, useRef, useState } from 'react';

const AudioRecorder = ({ onRecordingComplete, disabled }) => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.MediaRecorder) {
      setSupported(false);
    }
  }, []);

  const startRecording = async () => {
    setError('');
    if (!supported || disabled) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('瀏覽器不支援錄音功能。');
      setSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onRecordingComplete?.(blob);
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error('錄音失敗', err);
      setError('瀏覽器無法啟動錄音，請確認已授權麥克風。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
    }
  };

  if (!supported) {
    return <p className="hint-text">目前瀏覽器不支援錄音，可改用檔案上傳。</p>;
  }

  return (
    <div className="recorder">
      {error && <p className="error-text">{error}</p>}
      <div className="recorder-controls">
        <button type="button" onClick={startRecording} disabled={recording || disabled}>
          {recording ? '錄音中…' : '開始錄音'}
        </button>
        <button type="button" onClick={stopRecording} disabled={!recording}>
          結束錄音
        </button>
      </div>
      {recording && <p className="hint-text">錄音中，請按「結束錄音」停止並上傳。</p>}
    </div>
  );
};

export default AudioRecorder;
