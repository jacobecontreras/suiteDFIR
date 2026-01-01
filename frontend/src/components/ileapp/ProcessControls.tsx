import { useState, useEffect } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Input } from '../ui';
import { useProcessing } from '../../hooks/useProcessing';
import { useModules } from '../../hooks/useModules';
import { Square, Lock } from 'lucide-react';
import { createLeappApi } from '../../services/leappApi';
import { useToast } from '../../hooks/use-toast';

interface ProcessControlsProps {
  inputFile: string;
  outputFolder: string;
  reportName?: string;
  caseId?: number;
  timezone?: string;
}

export default function ProcessControls({ inputFile, outputFolder, reportName, caseId, timezone }: ProcessControlsProps) {
  const { selectedModules } = useModules();
  const { isProcessing, startProcessing, stopProcessing, progress, encryptionDetected } = useProcessing();
  const { toast } = useToast();

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  // Watch for runtime encryption detection
  useEffect(() => {
    if (encryptionDetected) {
      setShowPasswordDialog(true);
    }
  }, [encryptionDetected]);

  const handleStart = async () => {
    if (!inputFile) {
      toast({
        title: "Error",
        description: "Please select an input file or folder first.",
        variant: "destructive"
      });
      return;
    }

    // Only validate for iOS/iLEAPP
    // We can infer it's iLEAPP if the path looks like a backup or if we are on the iLEAPP page
    // But for now, let's just try to validate if it's a directory
    // Actually, the API is tool-specific. We should know which tool we are using.
    // The current context doesn't explicitly say "ileapp" vs "aleapp" here, but ProcessControls is in `ileapp` folder.
    // Let's assume iLEAPP for now or check if we can pass the tool prop.
    // Ideally ProcessControls should take a `tool` prop.
    // For now, I'll use 'ios' for validation as implemented in the backend.

    setIsValidating(true);
    try {
      const api = createLeappApi('ios');
      const validation = await api.processing.validateBackup(inputFile);

      if (validation.encrypted) {
        setShowPasswordDialog(true);
      } else {
        // Not encrypted, proceed normally
        await startProcessing(inputFile, outputFolder, Array.from(selectedModules), reportName, undefined, caseId, timezone);
      }
    } catch (error) {
      console.error("Validation failed:", error);
      // If validation fails (e.g. not a backup folder), just try to process anyway
      // It might be a zip or tar that the validator doesn't handle yet
      await startProcessing(inputFile, outputFolder, Array.from(selectedModules), reportName, undefined, caseId, timezone);
    } finally {
      setIsValidating(false);
    }
  };

  const handlePasswordSubmit = async () => {
    setShowPasswordDialog(false);
    try {
      await startProcessing(inputFile, outputFolder, Array.from(selectedModules), reportName, password, caseId, timezone);
      setPassword(''); // Clear password after sending
    } catch (error) {
      console.error("Processing failed:", error);
    }
  };

  const canStart = !isProcessing && selectedModules.size > 0 && !!reportName;

  return (
    <>
      <div className="w-full">
        {isProcessing ? (
          <Button
            variant="secondary"
            onClick={stopProcessing}
            className="w-full relative overflow-hidden bg-[#e5e5e5] text-black hover:bg-[#d4d4d4] border-none"
          >
            <div
              className="absolute inset-0 bg-black/5 transition-all duration-500"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
            <div className="relative z-10 flex items-center justify-center gap-2">
              <div className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
              <span>Stop Processing ({Math.round(progress.total > 0 ? (progress.current / progress.total) * 100 : 0)}%)</span>
            </div>
          </Button>
        ) : (
          <Button
            onClick={handleStart}
            disabled={!canStart || isValidating}
            className="w-full"
          >
            {isValidating ? (
              "Checking Backup..."
            ) : (
              "Start Processing"
            )}
          </Button>
        )}
      </div>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="max-w-[340px] p-5 bg-[#1A1A1A] border-[#333333] rounded-xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white tracking-wide uppercase">Encrypted Backup Detected</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              This iTunes backup is encrypted. Please enter the password to decrypt and analyze it.
            </p>
            <div className="relative">
              <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
              <Input
                type="password"
                placeholder="Backup Password"
                className="pl-8 h-8 text-xs bg-[#222] border-white/10 focus:border-white/20"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePasswordSubmit();
                }}
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
              onClick={() => setShowPasswordDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePasswordSubmit}
              disabled={!password}
              size="sm"
              className="flex-1 h-8 text-[11px] bg-white/10 hover:bg-white/20 text-white border border-white/10"
            >
              Unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}