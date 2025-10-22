import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { setupScene } from './setup.js';
import { UIManager } from './ui.js';
import { Game } from './game.js';
import { ReplayRecorder } from './replay.js';

// Global state
let game, ui, replayRecorder;
let scene, world, camera, renderer;

function init() {
    const {
        scene: s,
        world: w,
        camera: c,
        renderer: r,
        defaultMaterial: dm
    } = setupScene();
    scene = s;
    world = w;
    camera = c;
    renderer = r;

    ui = new UIManager();

    const gameCallbacks = {
        onScoreUpdate: (score) => ui.updateScore(score),
        onGameOver: (score) => {
            replayRecorder?.stop();
            ui.showGameOver(score);
        }
    };

    game = new Game(scene, world, dm, camera, gameCallbacks);
    
    setupEventListeners();
    
    renderer.setAnimationLoop(animate);
    startGame();
}

function startGame() {
    game.start();
    ui.hideGameOver();
    ui.showInstructions(true);
    
    replayRecorder = new ReplayRecorder(renderer.domElement);
}

function restart() {
    replayRecorder?.stop();
    game.restart();
    startGame();
}

async function viewReplay() {
    ui.setReplayButtonState(true, 'Rendering...');
    const blob = await replayRecorder.getReplayBlob();
    if (blob) {
        ui.showReplayViewer(blob);
    }
    ui.setReplayButtonState(false, 'Watch Replay');
}

function setupEventListeners() {
    ui.setupEventListeners({
        onPointerDown: () => {
            if (game.getState() === 'playing') {
                ui.showInstructions(false);
                game.onPointerDown();
            }
        },
        onRestart: restart,
        onViewReplay: viewReplay,
        onWindowResize: () => {
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = 4;
            camera.left = frustumSize * aspect / -2;
            camera.right = frustumSize * aspect / 2;
            camera.top = frustumSize / 2;
            camera.bottom = frustumSize / -2;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
}

function animate() {
    world.step(1 / 60);
    game.update();
    renderer.render(scene, camera);
}

init();