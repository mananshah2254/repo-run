import { useEffect, useState } from 'react';

export function RetryTime({ retryAt }: { retryAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const duration = `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds % 60}s`;
  return (
    <div className="retry-time" role="timer" aria-live="off">
      {seconds ? (
        <>
          Try again in <strong>{duration}</strong>. Retry time: {new Date(retryAt).toLocaleString()}
          .
        </>
      ) : (
        'The provider’s wait time has elapsed. You can try the check again.'
      )}
      <small>The next request may still be limited if other requests use the same allowance.</small>
    </div>
  );
}
