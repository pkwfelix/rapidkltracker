import { useState, useEffect, useRef } from "react";

interface RefreshSpinnerProps {
  intervalSeconds: number;
  onRefresh: () => void;
  isLoading: boolean;
}

export default function RefreshSpinner({
  intervalSeconds,
  onRefresh,
  isLoading,
}: RefreshSpinnerProps) {
  const [secondsLeft, setSecondsLeft] = useState(intervalSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldRefreshRef = useRef(false);

  useEffect(() => {
    setSecondsLeft(intervalSeconds);
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev: number) => {
        if (prev <= 1) {
          shouldRefreshRef.current = true;
          return intervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalSeconds, onRefresh]);

  useEffect(() => {
    if (shouldRefreshRef.current) {
      shouldRefreshRef.current = false;
      onRefresh();
    }
  }, [secondsLeft, onRefresh]);

  // Emit rapidtracker:tick events so NavSpinner can display the countdown
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("rapidtracker:tick", {
        detail: { secondsLeft, refreshing: isLoading },
      })
    );
  }, [secondsLeft, isLoading]);

  return null;
}
