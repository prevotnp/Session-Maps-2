import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Settings2, X, Move, RotateCcw } from "lucide-react";

interface DroneAdjustmentControlsProps {
  isVisible: boolean;
  onClose: () => void;
  adjustments: {
    scale: number;
    offsetLat: number;
    offsetLng: number;
  };
  onAdjustmentsChange: (adjustments: {
    scale: number;
    offsetLat: number;
    offsetLng: number;
  }) => void;
  onSavePosition: () => void;
}

export default function DroneAdjustmentControls({
  isVisible,
  onClose,
  adjustments,
  onAdjustmentsChange,
  onSavePosition
}: DroneAdjustmentControlsProps) {
  if (!isVisible) return null;

  return (
    <div className="absolute top-4 left-2 right-2 sm:left-auto sm:right-4 bg-white rounded-lg shadow-lg p-4 z-50 sm:w-80" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          <h3 className="font-medium">Adjust Drone Imagery</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Scale Control */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            Scale: {Math.round(adjustments.scale * 100)}%
          </label>
          <Slider
            value={[adjustments.scale]}
            onValueChange={([scale]) =>
              onAdjustmentsChange({ ...adjustments, scale })
            }
            min={0.3}
            max={1.5}
            step={0.05}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>30%</span>
            <span>150%</span>
          </div>
        </div>

        {/* North/South Position */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            Move North/South: {(adjustments.offsetLat * 1000).toFixed(1)}m
          </label>
          <Slider
            value={[adjustments.offsetLat]}
            onValueChange={([offsetLat]) =>
              onAdjustmentsChange({ ...adjustments, offsetLat })
            }
            min={-0.01}
            max={0.01}
            step={0.0001}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>South</span>
            <span>North</span>
          </div>
        </div>

        {/* East/West Position */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            Move East/West: {(adjustments.offsetLng * 1000).toFixed(1)}m
          </label>
          <Slider
            value={[adjustments.offsetLng]}
            onValueChange={([offsetLng]) =>
              onAdjustmentsChange({ ...adjustments, offsetLng })
            }
            min={-0.01}
            max={0.01}
            step={0.0001}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>West</span>
            <span>East</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() =>
              onAdjustmentsChange({
                scale: 1.0,
                offsetLat: 0,
                offsetLng: 0
              })
            }
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button
            variant="default"
            onClick={onSavePosition}
            className="bg-green-600 hover:bg-green-700"
          >
            Save Position
          </Button>
        </div>
      </div>
    </div>
  );
}