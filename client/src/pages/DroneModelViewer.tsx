import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, ZoomIn, ZoomOut, RotateCcw, Maximize } from 'lucide-react';
import type { DroneModel, DroneImage } from '@shared/schema';

export default function DroneModelViewer() {
  const params = useParams();
  const droneImageId = parseInt(params.id || '0');
  const [, navigate] = useLocation();
  
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: model, isLoading: isModelLoading } = useQuery<DroneModel>({
    queryKey: [`/api/drone-images/${droneImageId}/model`],
    enabled: droneImageId > 0
  });

  const { data: droneImage } = useQuery<DroneImage>({
    queryKey: [`/api/drone-images/${droneImageId}`],
    enabled: droneImageId > 0
  });

  useEffect(() => {
    if (!containerRef.current || !model) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    camera.position.set(0, 5, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 1000;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x8b4513, 0.4);
    scene.add(hemisphereLight);

    const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x333333);
    scene.add(gridHelper);

    const loadModel = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        if (!model?.filePath || !model?.fileType) {
          throw new Error('Model data is incomplete');
        }
        
        let fileUrl = model.filePath;
        if (model.filePath.includes('uploads/drone-models/')) {
          const relativePath = model.filePath.split('uploads/drone-models/')[1];
          fileUrl = `/api/drone-models/${relativePath}`;
        } else if (model.filePath.includes('uploads/')) {
          fileUrl = `/api/drone-models/${model.filePath.split('/').pop()}`;
        }
        
        const fileType = model.fileType.toLowerCase();
        
        const onProgress = (event: ProgressEvent) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            setLoadingProgress(Math.round(progress));
          }
        };

        let loadedObject: THREE.Object3D | null = null;

        if (fileType === 'glb' || fileType === 'gltf') {
          const loader = new GLTFLoader();
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.load(fileUrl, resolve, onProgress, reject);
          });
          loadedObject = gltf.scene;
        } else if (fileType === 'obj') {
          const objLoader = new OBJLoader();
          
          // Check if there's an MTL file for textures
          const mtlFilePath = (model as any).mtlFilePath;
          if (mtlFilePath) {
            const mtlUrl = mtlFilePath.includes('uploads/') 
              ? `/api/drone-models/${mtlFilePath.split('/').pop()}`
              : mtlFilePath;
            
            // Get base path for texture loading
            const basePath = '/api/drone-models/';
            
            const mtlLoader = new MTLLoader();
            mtlLoader.setPath(basePath);
            
            try {
              const materials = await new Promise<MTLLoader.MaterialCreator>((resolve, reject) => {
                const mtlFileName = mtlFilePath.split('/').pop();
                mtlLoader.load(mtlFileName, resolve, undefined, reject);
              });
              
              materials.preload();
              objLoader.setMaterials(materials);
              
              loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
                objLoader.load(fileUrl, resolve, onProgress, reject);
              });
            } catch (mtlError) {
              console.warn('Failed to load MTL, loading OBJ without materials:', mtlError);
              // Fall back to loading without materials
              loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
                objLoader.load(fileUrl, (obj) => {
                  const defaultMaterial = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    roughness: 0.7,
                    metalness: 0.1,
                    side: THREE.DoubleSide
                  });
                  obj.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                      if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
                        child.material = defaultMaterial;
                      }
                    }
                  });
                  resolve(obj);
                }, onProgress, reject);
              });
            }
          } else {
            // No MTL file, load with default material
            loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
              objLoader.load(fileUrl, (obj) => {
                const defaultMaterial = new THREE.MeshStandardMaterial({
                  color: 0x888888,
                  roughness: 0.7,
                  metalness: 0.1,
                  side: THREE.DoubleSide
                });
                obj.traverse((child) => {
                  if (child instanceof THREE.Mesh) {
                    if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
                      child.material = defaultMaterial;
                    }
                  }
                });
                resolve(obj);
              }, onProgress, (error) => {
                console.error('OBJ load error:', error);
                reject(error);
              });
            });
          }
        } else if (fileType === 'ply') {
          const loader = new PLYLoader();
          const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
            loader.load(fileUrl, resolve, onProgress, reject);
          });
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            flatShading: true,
            side: THREE.DoubleSide
          });
          loadedObject = new THREE.Mesh(geometry, material);
        }

        if (loadedObject) {
          const box = new THREE.Box3().setFromObject(loadedObject);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          
          loadedObject.position.sub(center);
          
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 10 / maxDim;
          loadedObject.scale.setScalar(scale);
          
          loadedObject.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          scene.add(loadedObject);
          modelRef.current = loadedObject;
          
          const distance = maxDim * scale * 2;
          camera.position.set(distance, distance / 2, distance);
          camera.lookAt(0, 0, 0);
          controls.target.set(0, 0, 0);
          controls.update();
        }
        
        setIsLoading(false);
      } catch (err: any) {
        console.error('Error loading model:', err);
        const errorMessage = err?.message || String(err);
        if (errorMessage.includes('mtl') || errorMessage.includes('material')) {
          setError('Failed to load 3D model materials. The model will display without textures.');
        } else if (errorMessage.includes('memory') || errorMessage.includes('size')) {
          setError('The 3D model file is too large to load in the browser. Try a smaller file or GLB format.');
        } else {
          setError(`Failed to load 3D model: ${errorMessage.substring(0, 100)}`);
        }
        setIsLoading(false);
      }
    };

    loadModel();

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [model]);

  const handleZoomIn = () => {
    if (cameraRef.current && controlsRef.current) {
      const direction = new THREE.Vector3();
      cameraRef.current.getWorldDirection(direction);
      cameraRef.current.position.addScaledVector(direction, 2);
      controlsRef.current.update();
    }
  };

  const handleZoomOut = () => {
    if (cameraRef.current && controlsRef.current) {
      const direction = new THREE.Vector3();
      cameraRef.current.getWorldDirection(direction);
      cameraRef.current.position.addScaledVector(direction, -2);
      controlsRef.current.update();
    }
  };

  const handleResetView = () => {
    if (cameraRef.current && controlsRef.current && modelRef.current) {
      const box = new THREE.Box3().setFromObject(modelRef.current);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 2;
      
      cameraRef.current.position.set(distance, distance / 2, distance);
      cameraRef.current.lookAt(0, 0, 0);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-[#1a1a2e] flex flex-col">
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/70 to-transparent p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="text-white hover:bg-white/20"
              data-testid="button-back"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-white text-lg font-semibold">
                {model?.name || droneImage?.name || '3D Model Viewer'}
              </h1>
              <p className="text-white/60 text-sm">
                {model?.fileType?.toUpperCase()} • {model?.sizeInMB} MB
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              className="text-white hover:bg-white/20"
              data-testid="button-zoom-in"
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              className="text-white hover:bg-white/20"
              data-testid="button-zoom-out"
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetView}
              className="text-white hover:bg-white/20"
              data-testid="button-reset-view"
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFullscreen}
              className="text-white hover:bg-white/20"
              data-testid="button-fullscreen"
            >
              <Maximize className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 w-full relative">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a2e] z-20">
            <Loader2 className="h-12 w-12 text-white animate-spin mb-4" />
            <p className="text-white text-lg mb-2">Loading 3D Model...</p>
            <div className="w-64 h-2 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-secondary transition-all duration-300 rounded-full"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-white/60 text-sm mt-2">{loadingProgress}%</p>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a2e] z-20">
            <p className="text-red-400 text-lg mb-4">{error}</p>
            <Button onClick={() => navigate('/')} data-testid="button-error-back">
              Go Back
            </Button>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-4">
        <div className="flex items-center justify-center gap-2 text-white/60 text-sm">
          <span>Drag to rotate</span>
          <span>•</span>
          <span>Scroll to zoom</span>
          <span>•</span>
          <span>Right-click drag to pan</span>
        </div>
      </div>
    </div>
  );
}
