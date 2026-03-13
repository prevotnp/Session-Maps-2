import React from 'react';
import { ZoomIn, ZoomOut, Compass, Box, MapPin, Ruler, Navigation2 } from 'lucide-react';

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onMyLocation: () => void;
  onResetNorth: () => void;
  onToggleTerrain: () => void;
  isMeasurementMode?: boolean;
  onToggleMeasurement?: () => void;
}

const MapControls: React.FC<MapControlsProps> = ({ 
  onZoomIn,
  onZoomOut,
  onMyLocation,
  onResetNorth,
  onToggleTerrain,
  isMeasurementMode = false,
  onToggleMeasurement
}) => {
  return (
    <div className="absolute top-24 right-4 z-10 flex flex-col space-y-3" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
      <button 
        className="bg-dark/80 rounded-full p-3 min-w-[44px] min-h-[44px] backdrop-blur-sm active:scale-95 transition-transform" 
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-5 w-5" />
      </button>
      
      <button 
        className="bg-dark/80 rounded-full p-3 min-w-[44px] min-h-[44px] backdrop-blur-sm active:scale-95 transition-transform"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-5 w-5" />
      </button>
      
      <div className="h-px w-full bg-white/20"></div>
      
      <button 
        className="bg-dark/80 rounded-full p-3 min-w-[44px] min-h-[44px] backdrop-blur-sm active:scale-95 transition-transform"
        onClick={onResetNorth}
        aria-label="Reset north"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,4 14.5,12 9.5,12" fill="#ef4444" stroke="none" />
          <polygon points="12,20 14.5,12 9.5,12" fill="currentColor" stroke="none" />
        </svg>
      </button>
      
      <button 
        className="bg-blue-600 rounded-full p-3 min-w-[44px] min-h-[44px] backdrop-blur-sm hover:bg-blue-700 active:scale-95 transition-transform"
        onClick={onMyLocation}
        aria-label="Center on my location"
        data-testid="button-my-location"
      >
        <Navigation2 className="h-5 w-5 text-white" />
      </button>

      {onToggleMeasurement && (
        <>
          <div className="h-px w-full bg-white/20"></div>
          
          <button 
            className={`${isMeasurementMode ? 'bg-orange-500' : 'bg-dark/80'} rounded-full p-3 min-w-[44px] min-h-[44px] backdrop-blur-sm transition-all active:scale-95`}
            onClick={onToggleMeasurement}
            aria-label="Measure distance"
            data-testid="button-measure-distance"
            title="Tap and hold with two fingers to measure distance"
          >
            <Ruler className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
};

export default MapControls;
