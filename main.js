import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const container = document.getElementById('container');
const canvas = document.getElementById('game-canvas');
const scoreElement = document.getElementById('score');
const instructionsElement = document.getElementById('instructions');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const replayButton = document.getElementById('replay-button');
const exportButton = document.getElementById('export-button');
const replayViewer = document.getElementById('replay-viewer');
const replayVideo = document.getElementById('replay-video');
const closeReplayButton = document.getElementById('close-replay');
const downloadReplayButton = document.getElementById('download-replay');
const replayControlsElement = document.getElementById('replay-controls');

let camera, scene, renderer;
let world;
let stack = [];
let overhangs = [];
let activeBlock;

const BLOCK_HEIGHT = 0.25;
const ORIGINAL_BLOCK_SIZE = 1;

let gameState = 'loading';
let defaultMaterial;

// Replay system
let replayRecorder = null;
let replayStream = null;
let currentReplayBlob = null;

class ReplayRecorder {
    constructor(canvas) {
        this.canvas = canvas;
        this.frames = [];
        this.isRecording = true;
    }

    capture() {
        if (!this.isRecording) return;
        
        // Convert canvas to blob and store frame data
        this.canvas.toBlob((blob) => {
            this.frames.push(blob);
        }, 'image/png');
    }

    async render() {
        return new Promise((resolve) => {
            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = this.canvas.width;
            videoCanvas.height = this.canvas.height;
            const ctx = videoCanvas.getContext('2d');

            const stream = videoCanvas.captureStream(30);
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 5000000
            });

            const chunks = [];
            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                resolve(blob);
            };

            mediaRecorder.start();

            // Draw all frames sequentially
            let frameIndex = 0;
            const drawNextFrame = async () => {
                if (frameIndex < this.frames.length) {
                    const blob = this.frames[frameIndex];
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0);
                        frameIndex++;
                        setTimeout(drawNextFrame, 1000 / 30);
                    };
                    img.src = URL.createObjectURL(blob);
                } else {
                    mediaRecorder.stop();
                }
            };

            drawNextFrame();
        });
    }

    stop() {
        this.isRecording = false;
    }
}

function init() {
    scene = new THREE.Scene();

    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 20;
    world.allowSleep = true;

    defaultMaterial = new CANNON.Material('default');
    const contactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
        friction: 0.4,
        restitution: 0.3,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 1e8
    });
    world.addContactMaterial(contactMaterial);
    world.defaultContactMaterial = contactMaterial;

    addBlock(0, 0, ORIGINAL_BLOCK_SIZE, ORIGINAL_BLOCK_SIZE, 'base');
    spawnNewBlock();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(10, 20, 0);
    scene.add(dirLight);

    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 4;
    camera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 1, 100);
    camera.position.set(4, 4, 4);
    camera.lookAt(0, 0, 0);
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    
    // Start replay recording
    replayRecorder = new ReplayRecorder(canvas);
    
    gameState = 'playing';

    restartButton.addEventListener('click', restart);
    replayButton.addEventListener('click', viewReplay);
    exportButton.addEventListener('click', exportReplay);
    closeReplayButton.addEventListener('click', closeReplay);
    downloadReplayButton.addEventListener('click', downloadReplay);

    window.addEventListener('resize', onWindowResize, false);
}

function restart() {
    // Clean up current replay
    replayRecorder?.stop();
    replayRecorder = null;

    overhangs.forEach(overhang => {
        scene.remove(overhang.mesh);
        overhang.mesh.geometry.dispose();
        overhang.mesh.material.dispose();
        if (overhang.body) world.removeBody(overhang.body);
    });
    stack.forEach(block => {
        scene.remove(block.mesh);
        block.mesh.geometry.dispose();
        block.mesh.material.dispose();
        if (block.body) world.removeBody(block.body);
    });
    if (activeBlock) {
        scene.remove(activeBlock);
        activeBlock.geometry.dispose();
        activeBlock.material.dispose();
        activeBlock = null;
    }

    stack = [];
    overhangs = [];

    scoreElement.innerText = '0';
    gameOverElement.classList.add('hidden');
    replayControlsElement.classList.add('hidden');
    instructionsElement.classList.remove('hidden');

    addBlock(0, 0, ORIGINAL_BLOCK_SIZE, ORIGINAL_BLOCK_SIZE, 'base');
    spawnNewBlock();
    camera.position.set(4, 4, 4);
    camera.lookAt(0, 0, 0);

    // Start new replay recording
    replayRecorder = new ReplayRecorder(canvas);
    gameState = 'playing';
}

async function viewReplay() {
    replayButton.disabled = true;
    replayButton.textContent = 'Rendering...';
    
    const blob = await replayRecorder.render();
    currentReplayBlob = blob;
    const url = URL.createObjectURL(blob);
    replayVideo.src = url;
    
    gameOverElement.classList.add('hidden');
    replayViewer.classList.remove('hidden');
    
    replayButton.disabled = false;
    replayButton.textContent = 'Watch Replay';
}

async function exportReplay() {
    exportButton.disabled = true;
    exportButton.textContent = 'Exporting...';
    
    if (!currentReplayBlob) {
        const blob = await replayRecorder.render();
        currentReplayBlob = blob;
    }
    
    downloadReplayButton.click();
    
    exportButton.disabled = false;
    exportButton.textContent = 'Export Video';
}

function closeReplay() {
    replayViewer.classList.add('hidden');
    gameOverElement.classList.remove('hidden');
}

function downloadReplay() {
    if (!currentReplayBlob) return;
    
    const url = URL.createObjectURL(currentReplayBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stacker-replay-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 4;
    camera.left = frustumSize * aspect / -2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = frustumSize / -2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('pointerdown', () => {
    if (gameState === 'playing') {
        if (instructionsElement) instructionsElement.classList.add('hidden');
        placeBlock();
    }
});

function addBlock(x, z, width, depth, type) {
    const y = BLOCK_HEIGHT * stack.length;
    const geometry = new THREE.BoxGeometry(width, BLOCK_HEIGHT, depth);
    
    const color = new THREE.Color(`hsl(${stack.length * 8}, 70%, 50%)`);
    const material = new THREE.MeshLambertMaterial({ color });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    if (type === 'active') {
        activeBlock = mesh;
    } else {
        const blockData = { mesh, width, depth };
        
        if (type === 'stacked') {
            const shape = new CANNON.Box(new CANNON.Vec3(width / 2, BLOCK_HEIGHT / 2, depth / 2));
            const body = new CANNON.Body({
                mass: 0,
                shape: shape,
                position: new CANNON.Vec3(x, y, z),
                material: defaultMaterial
            });
            world.addBody(body);
            blockData.body = body;
        }
        
        stack.push(blockData);
    }
}

function spawnNewBlock() {
    if(stack.length === 0) return;
    const prevBlock = stack[stack.length - 1];
    
    const direction = stack.length % 2 === 0 ? 'z' : 'x';
    const newWidth = prevBlock.width;
    const newDepth = prevBlock.depth;
    
    const x = direction === 'x' ? -2 : prevBlock.mesh.position.x;
    const z = direction === 'z' ? -2 : prevBlock.mesh.position.z;

    addBlock(x, z, newWidth, newDepth, 'active');
    activeBlock.userData.direction = direction;
    activeBlock.userData.speed = 0.02 + stack.length * 0.001;
}

function placeBlock() {
    if (!activeBlock) return;
    
    const prevBlock = stack[stack.length - 1];
    const direction = activeBlock.userData.direction;

    let overlap, overhang;
    let newWidth, newDepth;

    if (direction === 'x') {
        overlap = prevBlock.width - Math.abs(activeBlock.position.x - prevBlock.mesh.position.x);
        overhang = activeBlock.position.x > prevBlock.mesh.position.x ? 1 : -1;
        newWidth = overlap;
        newDepth = prevBlock.depth;
    } else {
        overlap = prevBlock.depth - Math.abs(activeBlock.position.z - prevBlock.mesh.position.z);
        overhang = activeBlock.position.z > prevBlock.mesh.position.z ? 1 : -1;
        newWidth = prevBlock.width;
        newDepth = overlap;
    }
    
    if (overlap <= 0) {
        gameOver();
        return;
    }

    const newX = direction === 'x' ? (activeBlock.position.x + prevBlock.mesh.position.x) / 2 : prevBlock.mesh.position.x;
    const newZ = direction === 'z' ? (activeBlock.position.z + prevBlock.mesh.position.z) / 2 : prevBlock.mesh.position.z;

    scene.remove(activeBlock);
    addBlock(newX, newZ, newWidth, newDepth, 'stacked');

    const overhangWidth = direction === 'x' ? Math.abs(prevBlock.width - overlap) : prevBlock.width;
    const overhangDepth = direction === 'z' ? Math.abs(prevBlock.depth - overlap) : prevBlock.depth;

    if (overhangWidth > 0.01 && overhangDepth > 0.01) {
        const overhangX = direction === 'x' ? newX + (overlap / 2 * overhang) + (overhangWidth / 2 * overhang) : newX;
        const overhangZ = direction === 'z' ? newZ + (overlap / 2 * overhang) + (overhangDepth / 2 * overhang) : newZ;
        
        const overhangGeometry = new THREE.BoxGeometry(overhangWidth, BLOCK_HEIGHT, overhangDepth);
        const overhangMaterial = activeBlock.material;
        const overhangMesh = new THREE.Mesh(overhangGeometry, overhangMaterial);
        overhangMesh.position.set(overhangX, activeBlock.position.y, overhangZ);
        scene.add(overhangMesh);
        
        const shape = new CANNON.Box(new CANNON.Vec3(overhangWidth / 2, BLOCK_HEIGHT / 2, overhangDepth / 2));
        const body = new CANNON.Body({
            mass: 1,
            shape: shape,
            position: new CANNON.Vec3(overhangX, activeBlock.position.y, overhangZ),
            linearDamping: 0.1,
            angularDamping: 0.2,
            collisionFilterGroup: 1,
            collisionFilterMask: 1,
            sleepSpeedLimit: 0.01,
            sleepTimeLimit: 2,
            material: defaultMaterial
        });
        body.allowSleep = false;
        body.wakeUp();
        world.addBody(body);
        
        const lateralSpeed = activeBlock.userData.speed * 40;
        if (direction === 'x') {
            body.velocity.set(lateralSpeed * overhang, -1, 0);
            body.angularVelocity.set(0, 0, activeBlock.userData.speed * 10);
        } else {
            body.velocity.set(0, -1, lateralSpeed * overhang);
            body.angularVelocity.set(activeBlock.userData.speed * 10, 0, 0);
        }
        
        body.applyImpulse(new CANNON.Vec3(0, -0.5, 0), body.position);
        
        overhangs.push({ 
            mesh: overhangMesh, 
            body: body, 
            stuckCounter: 0,
            originalColor: overhangMaterial.color.clone()
        });
    }
    
    activeBlock = null;

    scoreElement.innerText = stack.length - 1;

    const cameraY = BLOCK_HEIGHT * stack.length + 4;
    camera.position.y = cameraY;

    spawnNewBlock();
}

function gameOver() {
    gameState = 'gameover';
    replayRecorder?.stop();
    
    if (activeBlock) {
        const width = activeBlock.geometry.parameters.width;
        const depth = activeBlock.geometry.parameters.depth;
        
        const shape = new CANNON.Box(new CANNON.Vec3(width / 2, BLOCK_HEIGHT / 2, depth / 2));
        const body = new CANNON.Body({
            mass: 1,
            shape: shape,
            position: new CANNON.Vec3(activeBlock.position.x, activeBlock.position.y, activeBlock.position.z),
            linearDamping: 0.3,
            angularDamping: 0.3
        });
        body.velocity.x = activeBlock.userData.speed * 50;
        world.addBody(body);
        
        overhangs.push({ mesh: activeBlock, body: body });
        activeBlock = null;
    }
    finalScoreElement.innerText = stack.length - 1;
    gameOverElement.classList.remove('hidden');
    replayControlsElement.classList.remove('hidden');
}

function shatterBlock(overhang) {
    const particleCount = 20;
    const particles = [];
    const color = overhang.originalColor || overhang.mesh.material.color;
    
    for (let i = 0; i < particleCount; i++) {
        const size = Math.random() * 0.08 + 0.04;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshLambertMaterial({ color: color });
        const particleMesh = new THREE.Mesh(geometry, material);
        
        particleMesh.position.copy(overhang.mesh.position);
        scene.add(particleMesh);
        
        const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
        const body = new CANNON.Body({
            mass: 0.1,
            shape: shape,
            position: new CANNON.Vec3(
                overhang.mesh.position.x,
                overhang.mesh.position.y,
                overhang.mesh.position.z
            ),
            linearDamping: 0.3,
            angularDamping: 0.3,
            collisionFilterGroup: 2,
            collisionFilterMask: 0
        });
        
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 2;
        body.velocity.set(
            Math.cos(angle) * speed,
            Math.random() * 2 + 1,
            Math.sin(angle) * speed
        );
        body.angularVelocity.set(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
        );
        
        world.addBody(body);
        
        particles.push({ 
            mesh: particleMesh, 
            body: body,
            life: 120
        });
    }
    
    scene.remove(overhang.mesh);
    overhang.mesh.geometry.dispose();
    overhang.mesh.material.dispose();
    world.removeBody(overhang.body);
    
    return particles;
}

function animate() {
    world.step(1 / 60);
    
    // Capture frame for replay
    if (gameState === 'playing' && replayRecorder) {
        replayRecorder.capture();
    }
    
    const newOverhangs = [];
    const stackHeight = BLOCK_HEIGHT * stack.length;
    
    for (const overhang of overhangs) {
        if (overhang.spawnTime === undefined) {
            overhang.spawnTime = Date.now();
        }
        
        const timeSinceSpawn = Date.now() - overhang.spawnTime;
        const hasntFallen = overhang.body.position.y >= overhang.mesh.position.y - 0.3;
        
        if (timeSinceSpawn > 2000 && hasntFallen && overhang.life === undefined) {
            const particles = shatterBlock(overhang);
            overhangs.push(...particles);
            continue;
        }
        
        const velocity = overhang.body.velocity.length();
        const angularVelocity = overhang.body.angularVelocity.length();
        const isNearStack = overhang.body.position.y > stackHeight - 0.5 && 
                           overhang.body.position.y < stackHeight + 0.5;
        
        if (velocity < 0.5 && angularVelocity < 0.5 && isNearStack && !overhang.body.sleepState && overhang.life === undefined) {
            overhang.stuckCounter = (overhang.stuckCounter || 0) + 1;
            
            if (overhang.stuckCounter > 20) {
                const particles = shatterBlock(overhang);
                overhangs.push(...particles);
                continue;
            }
        } else {
            overhang.stuckCounter = 0;
        }
        
        overhang.mesh.position.copy(overhang.body.position);
        overhang.mesh.quaternion.copy(overhang.body.quaternion);
        
        if (overhang.life !== undefined) {
            overhang.life--;
            if (overhang.life <= 0 || overhang.mesh.position.y < -10) {
                scene.remove(overhang.mesh);
                overhang.mesh.geometry.dispose();
                overhang.mesh.material.dispose();
                world.removeBody(overhang.body);
                continue;
            }
        } else if (overhang.mesh.position.y < -10) {
            scene.remove(overhang.mesh);
            overhang.mesh.geometry.dispose();
            overhang.mesh.material.dispose();
            world.removeBody(overhang.body);
            continue;
        }
        
        newOverhangs.push(overhang);
    }
    overhangs = newOverhangs;

    if (gameState === 'playing' && activeBlock) {
        const speed = activeBlock.userData.speed;
        const direction = activeBlock.userData.direction;

        if (direction === 'x') {
            activeBlock.position.x += speed;
            if (activeBlock.position.x > 2 || activeBlock.position.x < -2) {
                activeBlock.userData.speed *= -1;
            }
        } else {
            activeBlock.position.z += speed;
            if (activeBlock.position.z > 2 || activeBlock.position.z < -2) {
                activeBlock.userData.speed *= -1;
            }
        }

        const targetCameraY = BLOCK_HEIGHT * stack.length + 4;
        camera.position.y += (targetCameraY - camera.position.y) * 0.1;
        camera.lookAt(0, stack.length * BLOCK_HEIGHT * 0.5, 0);
    }

    if (renderer) {
        renderer.render(scene, camera);
    }
}

init();