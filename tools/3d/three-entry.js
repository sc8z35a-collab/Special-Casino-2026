// What the 3D win titles need from three.js (js/render/win3d.js), as one
// global (window.BR3D): bundled into js/vendor/three-win.js by tools/3d/build.sh.
export { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, PMREMGenerator, Box3, Vector3, Group, SRGBColorSpace, ACESFilmicToneMapping } from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
