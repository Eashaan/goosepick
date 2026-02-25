import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Play, Square, RotateCcw, Download } from "lucide-react";
import { useActiveSession, type SessionStatus } from "@/hooks/useActiveSession";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SessionLifecycleControlsProps {
  setupCompleted: boolean;
}

const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
  live: {
    label: "Live",
    className: "bg-primary/15 text-primary border-primary/30",
  },
  ended: {
    label: "Ended",
    className: "bg-secondary text-muted-foreground border-border",
  },
};

const SessionLifecycleControls = ({ setupCompleted }: SessionLifecycleControlsProps) => {
  const {
    activeSession,
    sessionStatus,
    isLive,
    isEnded,
    isDraft,
    startSession,
    endSession,
    resetSession,
  } = useActiveSession();

  const [showEndDialog, setShowEndDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!activeSession?.id) return;
    setIsExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-session", {
        body: { sessionId: activeSession.id },
      });
      if (error) throw error;

      // data should be CSV text
      const blob = new Blob([data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${activeSession.session_label || activeSession.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err: any) {
      toast.error("Export failed: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    const expected = "RESET SESSION";
    if (resetPhrase.toUpperCase() !== expected) {
      toast.error(`Type "${expected}" to confirm`);
      return;
    }
    resetSession.mutate();
    setShowResetDialog(false);
    setResetPhrase("");
  };

  const config = sessionStatus ? statusConfig[sessionStatus] : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Status pill */}
      {config && (
        <Badge variant="outline" className={`text-xs ${config.className}`}>
          {config.label}
        </Badge>
      )}

      {/* Start Session */}
      {(!activeSession || isDraft) && setupCompleted && (
        <Button
          size="sm"
          onClick={() => startSession.mutate()}
          disabled={startSession.isPending}
          className="gap-1.5 h-8 text-xs"
        >
          <Play className="h-3 w-3" />
          Start Session
        </Button>
      )}

      {/* End Session */}
      {isLive && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setShowEndDialog(true)}
          disabled={endSession.isPending}
          className="gap-1.5 h-8 text-xs"
        >
          <Square className="h-3 w-3" />
          End Session
        </Button>
      )}

      {/* Reset Session */}
      {(isDraft || isEnded || isLive) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowResetDialog(true)}
          disabled={resetSession.isPending}
          className="gap-1.5 h-8 text-xs text-muted-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
      )}

      {/* Export (ended only) */}
      {isEnded && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={isExporting}
          className="gap-1.5 h-8 text-xs"
        >
          <Download className="h-3 w-3" />
          {isExporting ? "Exporting..." : "Export CSV"}
        </Button>
      )}

      {/* End Session Dialog */}
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this session?</AlertDialogTitle>
            <AlertDialogDescription>
              All scoring will become read-only. The session data will remain archived and downloadable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => endSession.mutate()}>
              End Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Session Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all matches, players, groups, and scoring data for this session. The setup wizard will reopen for a fresh configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <p className="text-sm text-muted-foreground mb-2">
              Type <strong>RESET SESSION</strong> to confirm:
            </p>
            <Input
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              placeholder="RESET SESSION"
              className="font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResetPhrase("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SessionLifecycleControls;
