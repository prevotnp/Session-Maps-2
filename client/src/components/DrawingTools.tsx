import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, GitBranch, Hexagon, Ruler, CheckCircle2, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateTotalDistance, calculateSegmentDistances, formatDistance, calculateElevationChange } from '@/lib/mapUtils';

interface DrawingToolsProps {
  isDrawing: boolean;
  drawingMode: string | null;
  onStartDrawingMode: (mode: string) => void;
  onCancelDrawing: () => void;
  onFinishDrawing: () => void;
  currentDrawing: {
    points: [number, number][];
    type: string;
    name: string;
    measurementValue?: number;
    measurementUnit?: string;
  } | null;
}

const DrawingTools: React.FC<DrawingToolsProps> = ({
  isDrawing,
  drawingMode,
  onStartDrawingMode,
  onCancelDrawing,
  onFinishDrawing,
  currentDrawing
}) => {
  const [measurements, setMeasurements] = useState<{
    segmentDistances: number[];
    totalDistance: number;
    elevationData: {
      elevations: (number | null)[];
      totalChange: number | null;
      netChange: number | null;
    };
  } | null>(null);

  // Calculate measurements when points change
  useEffect(() => {
    if (currentDrawing && currentDrawing.points.length >= 2) {
      const segmentDistances = calculateSegmentDistances(currentDrawing.points);
      const totalDistance = calculateTotalDistance(currentDrawing.points);
      
      // Calculate elevation changes asynchronously
      calculateElevationChange(currentDrawing.points).then(elevationData => {
        setMeasurements({
          segmentDistances,
          totalDistance,
          elevationData
        });
      });
    } else {
      setMeasurements(null);
    }
  }, [currentDrawing?.points]);

  return (
    <div className="absolute top-20 left-2 z-10 p-2 bg-white/80 backdrop-blur-sm rounded-lg shadow-md" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="flex flex-col gap-2">
        {!isDrawing ? (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onStartDrawingMode('waypoint')}
                    className={drawingMode === 'waypoint' ? 'bg-primary text-white' : ''}
                  >
                    <MapPin className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Add Waypoint</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onStartDrawingMode('line')}
                    className={drawingMode === 'line' ? 'bg-primary text-white' : ''}
                  >
                    <GitBranch className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Draw Line</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onStartDrawingMode('polygon')}
                    className={drawingMode === 'polygon' ? 'bg-primary text-white' : ''}
                  >
                    <Hexagon className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Draw Area</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onStartDrawingMode('measurement')}
                    className={drawingMode === 'measurement' ? 'bg-primary text-white' : ''}
                  >
                    <Ruler className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Measure Distance</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        ) : (
          <>
            {/* Show drawing information */}
            <div className="bg-white p-3 rounded-md mb-2 text-sm max-w-xs">
              <p className="font-medium mb-2">{drawingMode ? drawingMode.charAt(0).toUpperCase() + drawingMode.slice(1) : 'Drawing'}</p>
              <p className="text-xs text-gray-500 mb-2">Points: {currentDrawing?.points.length || 0}</p>
              
              {/* Distance measurements */}
              {measurements && measurements.segmentDistances.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-blue-600">Segment Distances:</p>
                  {measurements.segmentDistances.map((distance, index) => (
                    <p key={index} className="text-xs text-gray-600">
                      Point {index + 1} → {index + 2}: {formatDistance(distance)}
                    </p>
                  ))}
                  <p className="text-xs font-medium text-green-600 mt-2">
                    Total Distance: {formatDistance(measurements.totalDistance)}
                  </p>
                </div>
              )}
              
              {/* Elevation information */}
              {measurements?.elevationData && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-xs font-medium text-purple-600">Elevation:</p>
                  {measurements.elevationData.netChange !== null && (
                    <p className="text-xs text-gray-600">
                      Net Change: {measurements.elevationData.netChange > 0 ? '+' : ''}{measurements.elevationData.netChange?.toFixed(1)}m
                    </p>
                  )}
                  {measurements.elevationData.totalChange !== null && (
                    <p className="text-xs text-gray-600">
                      Total Change: {measurements.elevationData.totalChange.toFixed(1)}m
                    </p>
                  )}
                </div>
              )}
              
              {/* Legacy measurement display for compatibility */}
              {currentDrawing?.measurementValue && (
                <p className="text-xs font-medium mt-2 text-orange-600">
                  {currentDrawing.measurementValue} {currentDrawing.measurementUnit?.replace('_', ' ')}
                </p>
              )}
            </div>
            
            {/* Drawing control buttons */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onFinishDrawing}
                    className="bg-green-500 text-white hover:bg-green-600"
                    disabled={currentDrawing?.points.length === 0}
                  >
                    <CheckCircle2 className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Finish Drawing</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onCancelDrawing}
                    className="bg-red-500 text-white hover:bg-red-600"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Cancel Drawing</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
      </div>
    </div>
  );
};

export default DrawingTools;