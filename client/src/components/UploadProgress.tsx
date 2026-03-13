import React from 'react';
import { Progress } from '@/components/ui/progress';
import { X, Upload } from 'lucide-react';

interface UploadProgressProps {
  isVisible: boolean;
  fileName: string;
  fileSize: number;
  bytesUploaded: number;
  onCancel: () => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({
  isVisible,
  fileName,
  fileSize,
  bytesUploaded,
  onCancel
}) => {
  if (!isVisible) return null;

  const totalSizeMB = Math.round(fileSize / (1024 * 1024));
  const uploadedMB = Math.round(bytesUploaded / (1024 * 1024));
  const remainingMB = totalSizeMB - uploadedMB;
  const progress = fileSize > 0 ? (bytesUploaded / fileSize) * 100 : 0;
  
  // Calculate estimated time remaining (assuming 1MB/s average upload speed)
  const estimatedSecondsRemaining = remainingMB;
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="fixed top-4 left-2 right-2 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 bg-dark border border-white/10 rounded-lg p-4 z-50 shadow-lg" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="w-full sm:w-80">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-medium text-white">Uploading...</span>
          </div>
          <button 
            onClick={onCancel}
            className="text-white/60 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        <div className="mb-2">
          <div className="text-xs text-white/80 truncate">{fileName}</div>
          <div className="text-xs text-white/60">
            {uploadedMB}MB / {totalSizeMB}MB • {remainingMB}MB remaining
          </div>
        </div>
        

        
        <div className="flex justify-between text-xs text-white/60">
          <span>{Math.round(progress)}% complete</span>
          <span>~{formatTime(estimatedSecondsRemaining)} remaining</span>
        </div>
      </div>
    </div>
  );
};