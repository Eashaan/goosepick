interface SessionSummaryStripProps {
  totalCourts: number;
  groupCount: number;
  activeCount: number;
  liveCount: number;
}

const SessionSummaryStrip = ({ totalCourts, groupCount, activeCount, liveCount }: SessionSummaryStripProps) => {
  const parts = [
    `${totalCourts} Court${totalCourts !== 1 ? "s" : ""}`,
    `${groupCount} Group${groupCount !== 1 ? "s" : ""}`,
    `${activeCount} Active`,
    `${liveCount} Live`,
  ];

  return (
    <p className="text-xs text-muted-foreground/70 tracking-wide text-center">
      {parts.join(" · ")}
    </p>
  );
};

export default SessionSummaryStrip;
