import { useState, useEffect } from 'react';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Input } from '@/components/ui';
import { useLeapp } from '../../context/LeappContext';
import { Lock } from 'lucide-react';
import { createLeappApi } from '@/lib/leappApi';
import { useToast } from '../../hooks/useToast';
import { getUniqueName } from '@/lib/naming';

interface ProcessControlsProps {
  tool: 'ileapp' | 'aleapp';
  inputFile: string;
  outputFolder: string;
  reportName?: string;
  caseId?: number;
  existingNames: string[];
}

export default function ProcessControls({ tool, inputFile, outputFolder, reportName, caseId, existingNames }: ProcessControlsProps) {
  const { states, startProcessing } = useLeapp();
  const toolState = states[tool];
  const { isProcessing, encryptionDetected } = toolState.processing;
  const { selectedModules } = toolState.config;
  const { toast } = useToast();

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isPasswordError, setIsPasswordError] = useState(false);

  // Watch for runtime encryption detection
  useEffect(() => {
    if (encryptionDetected) {
      setShowPasswordDialog(true);
    }
  }, [encryptionDetected]);

  // Listen for password errors broadcast from Context
  useEffect(() => {
    const handlePasswordError = (e: any) => {
      if (e.detail?.tool === tool) {
        // We re-open the dialog so they can easily retry
        setIsPasswordError(true);
        setShowPasswordDialog(true);
        setPassword(''); 
      }
    };

    window.addEventListener('leapp-password-error', handlePasswordError);
    return () => window.removeEventListener('leapp-password-error', handlePasswordError);
  }, [tool, toast]);

  const handleStart = async () => {
    if (!inputFile) {
      toast({
        title: "Error",
        description: "Please select an input file or folder first.",
        variant: "destructive"
      });
      return;
    }

    if (!reportName) return;

    // Generate unique name
    const uniqueName = getUniqueName(reportName, existingNames);

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

      if (!validation.valid) {
        toast({
          title: "Validation Failed",
          description: validation.error || "The selected folder is not a valid backup.",
          variant: "destructive"
        });
        return;
      }

      if (validation.encrypted) {
        setShowPasswordDialog(true);
      } else {
        // Not encrypted, proceed normally
        await startProcessing(tool, inputFile, outputFolder, uniqueName, undefined, caseId);
      }
    } catch (error) {
      console.error("Validation failed:", error);
      toast({
        title: "Validation Error",
        description: "An error occurred while validating the backup. Please check logs.",
        variant: "destructive"
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handlePasswordSubmit = async () => {
    setShowPasswordDialog(false);
    if (!reportName) return;

    const uniqueName = getUniqueName(reportName, existingNames);

    try {
      await startProcessing(tool, inputFile, outputFolder, uniqueName, password, caseId);
      setPassword(''); // Clear password after sending
    } catch (error) {
      console.error("Processing failed:", error);
    }
  };

  const canStart = !isProcessing && selectedModules && selectedModules.length > 0 && !!reportName;

  return (
    <>
      <div className="w-full">
        <Button
          onClick={handleStart}
          disabled={!canStart || isValidating}
          className="w-full h-9"
        >
          {isValidating ? (
            "Checking Backup..."
          ) : isProcessing ? (
            "Processing..."
          ) : (
            "Start Processing"
          )}
        </Button>
      </div>

      <Dialog open={showPasswordDialog} onOpenChange={(open: boolean) => setShowPasswordDialog(open)}>
        <DialogContent className="max-w-[340px] p-5 bg-[#1A1A1A] border-[#333333] rounded-xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white tracking-wide uppercase">Encrypted Backup Detected</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              This iTunes backup is encrypted. Please enter the password to decrypt and analyze it.
            </p>
            {isPasswordError && (
              <p className="text-[11px] text-red-500 font-medium animate-in fade-in slide-in-from-top-1">
                Wrong password
              </p>
            )}
            <div className="relative">
              <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
              <Input
                type="password"
                placeholder="Backup Password"
                className={`pl-8 h-8 text-xs bg-[#222] border-white/10 focus:border-white/20 ${isPasswordError ? 'border-red-500/50 focus:border-red-500' : ''}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (isPasswordError) setIsPasswordError(false);
                }}
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
