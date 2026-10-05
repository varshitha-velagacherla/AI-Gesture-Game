/* ==========================================================================
   Gesture Catch - Core Game Script
   Features: Real-time hand tracking, canvas physics, neon styling, difficulty levels,
             fist gesture for pausing, pinch gesture for expanding basket size.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------------
    // 1. DOM Elements & Canvas Init
    // ----------------------------------------------------------------------
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const gameFrame = document.getElementById('game-frame');
    
    // Custom overlays and badges
    const startScreen = document.getElementById('start-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const pauseScreen = document.getElementById('pause-screen');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const statusBanner = document.getElementById('status-banner');
    const statusMessage = document.getElementById('status-message');
    
    // HUD items
    const hud = document.getElementById('hud');
    const hudScore = document.getElementById('hud-score');
    const hudLevel = document.getElementById('hud-level');
    const heartsContainer = document.getElementById('hud-health-hearts');
    const finalScoreText = document.getElementById('final-score');
    const finalLevelText = document.getElementById('final-level');
    const finalTimeText = document.getElementById('final-time');
    
    // AI Tracking elements
    const aiBadge = document.getElementById('ai-badge');
    const badgeText = document.getElementById('badge-text');
    const inputModeBadge = document.getElementById('input-mode-badge');
    const webcamVideo = document.getElementById('webcam-video');
    const webcamCanvas = document.getElementById('webcam-canvas');
    const webcamCtx = webcamCanvas.getContext('2d');
    const cameraPlaceholder = document.getElementById('camera-placeholder');
    const cameraPlaceholderText = document.getElementById('camera-placeholder-text');

    // ----------------------------------------------------------------------
    // 2. Game Settings & Variables
    // ----------------------------------------------------------------------
    const GAME_STATES = {
        START: 'START',
        PLAYING: 'PLAYING',
        PAUSED: 'PAUSED',
        GAMEOVER: 'GAMEOVER'
    };
    
    let currentGameState = GAME_STATES.START;
    
    // Game Physics & Elements constants
    const BASE_SPAWN_INTERVAL = 80; // frames
    const MIN_SPAWN_INTERVAL = 25; // frames (fast spawn threshold)
    const MAX_HEALTH = 3;
    const BASE_BASKET_WIDTH = 130;
    const PINCH_BASKET_WIDTH = 230;
    
    let score = 0;
    let health = MAX_HEALTH;
    let level = 1;
    let secondsElapsed = 0;
    
    // Tracking active timing parameters
    let spawnTimer = 0;
    let startTime = null;
    let levelTimer = 0;
    let pauseStartTime = null;
    
    // Basket Object Position
    let basket = {
        x: canvas.width / 2,
        y: canvas.height - 50,
        width: BASE_BASKET_WIDTH,
        targetWidth: BASE_BASKET_WIDTH,
        height: 20,
        targetX: canvas.width / 2,
        speed: 12, // Keyboard move speed scaler
        color: '#00f5ff'
    };

    // Keyboard Fallback status tracking
    let keys = {
        ArrowLeft: false,
        ArrowRight: false,
        Space: false
    };

    // Arrays for active elements
    let fallingObjects = [];
    let particles = [];
    
    // Camera Tracking states
    let isCameraAvailable = false;
    let handDetected = false;
    let indexFingerX = 0.5; // Normalized x coords (0..1)
    let isPinching = false;
    let isFist = false;
    let cameraInstance = null;
    
    // ----------------------------------------------------------------------
    // 3. Gesture Detection Helpers
    // ----------------------------------------------------------------------
    // Detect if hand is closed into a fist
    function isFistGesture(landmarks) {
        let foldedFingers = 0;
        // Index: tip (8) vs PIP (6)
        if (landmarks[8].y > landmarks[6].y) foldedFingers++;
        // Middle: tip (12) vs PIP (10)
        if (landmarks[12].y > landmarks[10].y) foldedFingers++;
        // Ring: tip (16) vs PIP (14)
        if (landmarks[16].y > landmarks[14].y) foldedFingers++;
        // Pinky: tip (20) vs PIP (18)
        if (landmarks[20].y > landmarks[18].y) foldedFingers++;

        return foldedFingers >= 3;
    }

    // Detect if thumb and index finger are pinching together
    function isPinchGesture(landmarks) {
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const distance = Math.hypot(dx, dy);
        return distance < 0.065; // Normalized distance threshold
    }

    // ----------------------------------------------------------------------
    // 4. Fallback Keyboard Controls Setup
    // ----------------------------------------------------------------------
    window.addEventListener('keydown', (e) => {
        if (e.code in keys) {
            keys[e.code] = true;
            if (e.code === 'Space' && currentGameState === GAME_STATES.START) {
                startGame();
            }
        }
        
        // Pause toggle shortcuts (Escape or 'P')
        if (e.code === 'Escape' || e.code === 'KeyP') {
            if (currentGameState === GAME_STATES.PLAYING) {
                pauseGame();
            } else if (currentGameState === GAME_STATES.PAUSED) {
                resumeGame();
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code in keys) {
            keys[e.code] = false;
        }
    });

    // Make canvas response-ready
    function resizeWebcamCanvas() {
        webcamCanvas.width = webcamVideo.videoWidth || 640;
        webcamCanvas.height = webcamVideo.videoHeight || 480;
    }

    // ----------------------------------------------------------------------
    // 5. MediaPipe Hand Tracking Setup
    // ----------------------------------------------------------------------
    function initMediaPipe() {
        console.log("Initializing MediaPipe Hands...");
        
        try {
            const hands = new Hands({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                }
            });

            hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.6,
                minTrackingConfidence: 0.6
            });

            hands.onResults(onHandResults);

            cameraInstance = new Camera(webcamVideo, {
                onFrame: async () => {
                    try {
                        await hands.send({ image: webcamVideo });
                    } catch (e) {
                        console.error("Frame processing failed", e);
                    }
                },
                width: 640,
                height: 480
            });

            cameraInstance.start()
                .then(() => {
                    console.log("Webcam service successfully connected!");
                    isCameraAvailable = true;
                    aiBadge.className = "badge badge-connecting";
                    badgeText.innerText = "Connecting AI...";
                    inputModeBadge.innerText = "Webcam active (Connecting model)";
                    cameraPlaceholderText.innerText = "Waking up Hand Tracker...";
                })
                .catch((err) => {
                    console.warn("Webcam access rejected. Switching to keyboard controls:", err);
                    onCameraFailure("Camera permission denied.");
                });

        } catch (e) {
            console.error("Failed to load MediaPipe module:", e);
            onCameraFailure("MediaPipe runtime error.");
        }
    }

    function onCameraFailure(reason) {
        isCameraAvailable = false;
        cameraPlaceholder.style.backgroundColor = "rgba(7, 10, 18, 0.95)";
        cameraPlaceholderText.innerHTML = `<span class="red-text">Camera Unavailable</span><br><br><span style="font-size:0.75rem; color:var(--text-subtle); line-height:1.4;">${reason}<br>Fallback keyboard arrow keys active.</span>`;
        const spinner = cameraPlaceholder.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';

        aiBadge.className = "badge badge-disconnected";
        badgeText.innerText = "Camera Disabled";
        inputModeBadge.className = "mode-text red-text";
        inputModeBadge.innerText = "Keyboard Mode (Arrow Keys)";
        
        statusBanner.className = "status-banner";
        statusBanner.style.borderColor = "var(--neon-purple)";
        statusBanner.style.background = "rgba(189, 0, 255, 0.1)";
        statusMessage.className = "red-text";
        statusMessage.innerHTML = "Webcam disabled. Feel free to use Left/Right arrows to play, and Space to expand size!";
        statusBanner.classList.remove('hidden');
    }

    // MediaPipe Hand Detection Callback
    function onHandResults(results) {
        if (cameraPlaceholder && !cameraPlaceholder.classList.contains('hidden')) {
            cameraPlaceholder.classList.add('hidden');
            resizeWebcamCanvas();
        }

        webcamCtx.save();
        webcamCtx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            handDetected = true;
            const landmarks = results.multiHandLandmarks[0];
            
            // Analyze gestures
            isFist = isFistGesture(landmarks);
            isPinch = isPinchGesture(landmarks);
            
            // Extract INDEX_FINGER_TIP coordinate (index 8)
            indexFingerX = landmarks[8].x;

            // Handle Fist / Pause logic
            if (isFist) {
                aiBadge.className = "badge badge-connecting";
                badgeText.innerText = "Hand Closed (Fist)";
                inputModeBadge.className = "mode-text red-text";
                inputModeBadge.innerText = "Gesture: Hand Closed (Pause)";
                
                if (currentGameState === GAME_STATES.PLAYING) {
                    pauseGame();
                }
            } else {
                aiBadge.className = "badge badge-active";
                badgeText.innerText = isPinch ? "Pinch Active (Expanded)" : "AI Tracking Active";
                inputModeBadge.className = "mode-text cyan-text";
                inputModeBadge.innerText = isPinch ? "Gesture: Pinch (Expand Size)" : "Gestures (Index finger tip)";

                if (currentGameState === GAME_STATES.PAUSED) {
                    resumeGame();
                }
            }

            if (currentGameState === GAME_STATES.PLAYING) {
                statusBanner.classList.add('hidden');
            } else if (currentGameState === GAME_STATES.START) {
                statusBanner.classList.remove('hidden');
                statusMessage.innerHTML = "<span class='cyan-text'>Hand Detected!</span> Ready to start.";
            }

            // Draw skeleton lines
            const connectorColor = isFist ? '#ef4444' : (isPinch ? '#00ffff' : '#00f5ff');
            drawConnectors(webcamCtx, landmarks, HAND_CONNECTIONS, { color: connectorColor, lineWidth: 3 });
            drawLandmarks(webcamCtx, landmarks, { color: '#bd00ff', lineWidth: 1, radius: 4 });
            
        } else {
            handDetected = false;
            isFist = false;
            isPinch = false;
            aiBadge.className = "badge badge-connecting";
            badgeText.innerText = "No Hand Detected";
            
            if (currentGameState === GAME_STATES.PLAYING) {
                statusBanner.className = "status-banner";
                statusMessage.innerHTML = "⚠️ Place your hand in camera frame to continue!";
                statusBanner.classList.remove('hidden');
            }
        }
        
        webcamCtx.restore();
    }

    // ----------------------------------------------------------------------
    // 6. Game State Controls
    // ----------------------------------------------------------------------
    function startGame() {
        console.log("Starting Gesture Catch...");
        
        score = 0;
        health = MAX_HEALTH;
        level = 1;
        secondsElapsed = 0;
        startTime = Date.now();
        levelTimer = Date.now();
        spawnTimer = 0;
        
        fallingObjects = [];
        particles = [];
        
        basket.x = canvas.width / 2;
        basket.targetX = canvas.width / 2;
        basket.width = BASE_BASKET_WIDTH;
        basket.targetWidth = BASE_BASKET_WIDTH;
        
        updateHUD();
        
        currentGameState = GAME_STATES.PLAYING;
        
        startScreen.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        pauseScreen.classList.add('hidden');
        hud.classList.remove('hidden');

        if (handDetected || !isCameraAvailable) {
            statusBanner.classList.add('hidden');
        } else {
            statusBanner.className = "status-banner";
            statusMessage.innerHTML = "Show your hand to start";
            statusBanner.classList.remove('hidden');
        }
    }

    function pauseGame() {
        if (currentGameState !== GAME_STATES.PLAYING) return;
        currentGameState = GAME_STATES.PAUSED;
        pauseStartTime = Date.now();
        pauseScreen.classList.remove('hidden');
    }

    function resumeGame() {
        if (currentGameState !== GAME_STATES.PAUSED) return;
        currentGameState = GAME_STATES.PLAYING;
        if (pauseStartTime) {
            const pausedDuration = Date.now() - pauseStartTime;
            startTime += pausedDuration;
            levelTimer += pausedDuration;
        }
        pauseScreen.classList.add('hidden');
    }

    function gameOver() {
        console.log("Game Over triggered!");
        currentGameState = GAME_STATES.GAMEOVER;
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        finalScoreText.innerText = score;
        finalLevelText.innerText = level;
        finalTimeText.innerText = `${elapsed}s`;
        
        hud.classList.add('hidden');
        statusBanner.classList.add('hidden');
        pauseScreen.classList.add('hidden');
        
        gameOverScreen.classList.remove('hidden');
    }

    function updateHUD() {
        hudScore.innerText = String(score).padStart(3, '0');
        hudLevel.innerText = level;
        
        heartsContainer.innerHTML = '';
        for (let i = 0; i < MAX_HEALTH; i++) {
            const h = document.createElement('span');
            h.className = i < health ? 'heart active' : 'heart';
            h.innerText = '♥';
            heartsContainer.appendChild(h);
        }
    }

    function spawnObject() {
        const radius = 14 + Math.random() * 8;
        const x = radius + Math.random() * (canvas.width - radius * 2);
        const y = -radius;
        
        const isBad = Math.random() < 0.28;
        const speedMultiplier = 1.0 + (level - 1) * 0.15;
        const objectSpeed = (2.5 + Math.random() * 2.5) * speedMultiplier;
        
        fallingObjects.push({
            x,
            y,
            radius,
            type: isBad ? 'bad' : 'good',
            speed: objectSpeed,
            pulseWave: Math.random() * Math.PI * 2,
            glowIntensity: 10 + Math.random() * 10
        });
    }

    function createExplosion(x, y, colorCode) {
        const count = 12 + Math.floor(Math.random() * 6);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const velocity = 2 + Math.random() * 5;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * velocity,
                vy: Math.sin(angle) * velocity - 1,
                radius: 2 + Math.random() * 4,
                color: colorCode,
                alpha: 1,
                decay: 0.02 + Math.random() * 0.03
            });
        }
    }

    function triggerDamageOverlay() {
        gameFrame.className = "game-frame shake";
        setTimeout(() => {
            gameFrame.className = "game-frame";
        }, 300);

        const overlay = document.createElement('div');
        overlay.className = 'damage-flash';
        const canvasContainer = document.querySelector('.canvas-wrapper');
        canvasContainer.appendChild(overlay);
        
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                }, 150);
            }, 100);
        });
    }

    // ----------------------------------------------------------------------
    // 7. Draw & Physics calculations
    // ----------------------------------------------------------------------
    function updatePhysics() {
        if (currentGameState !== GAME_STATES.PLAYING) return;

        const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
        if (currentElapsed > secondsElapsed) {
            secondsElapsed = currentElapsed;
        }

        const timeDiff = Date.now() - levelTimer;
        if (timeDiff > 25000) {
            level++;
            levelTimer = Date.now();
            updateHUD();
            
            statusBanner.className = "status-banner";
            statusBanner.style.borderColor = "var(--neon-purple)";
            statusBanner.style.background = "rgba(189, 0, 255, 0.15)";
            statusMessage.innerHTML = `🔮 <strong>LEVEL ${level}</strong> - Falling speed boosted!`;
            statusBanner.classList.remove('hidden');
            setTimeout(() => {
                if (currentGameState === GAME_STATES.PLAYING && handDetected) {
                    statusBanner.classList.add('hidden');
                }
            }, 3000);
        }

        // Target width determination (Pinch gesture or Space key)
        const shouldExpand = (isCameraAvailable && handDetected && isPinch) || keys.Space;
        basket.targetWidth = shouldExpand ? PINCH_BASKET_WIDTH : BASE_BASKET_WIDTH;
        
        // Lerp width transition
        basket.width += (basket.targetWidth - basket.width) * 0.18;

        // Update Catcher horizontal coordination
        if (isCameraAvailable && handDetected) {
            const targetX = (1 - indexFingerX) * canvas.width;
            basket.x += (targetX - basket.x) * 0.16;
        } else {
            if (keys.ArrowLeft) {
                basket.x -= basket.speed;
            }
            if (keys.ArrowRight) {
                basket.x += basket.speed;
            }
        }

        // Lock basket boundary bounds
        basket.x = Math.max(basket.width / 2, Math.min(canvas.width - basket.width / 2, basket.x));

        // Spawning Rate calculation
        const maxLevelSpawnOffset = Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - (level - 1) * 8);
        spawnTimer++;
        if (spawnTimer >= maxLevelSpawnOffset) {
            spawnObject();
            spawnTimer = 0;
        }

        // Update falling items
        for (let i = fallingObjects.length - 1; i >= 0; i--) {
            const obj = fallingObjects[i];
            obj.y += obj.speed;
            obj.pulseWave += 0.05;

            const basketTop = basket.y;
            const basketLeft = basket.x - basket.width / 2;
            const basketRight = basket.x + basket.width / 2;
            
            const caught = (obj.y + obj.radius >= basketTop) && 
                           (obj.y - obj.radius <= basketTop + basket.height) && 
                           (obj.x + obj.radius >= basketLeft) && 
                           (obj.x - obj.radius <= basketRight);

            if (caught) {
                if (obj.type === 'good') {
                    score += 10;
                    createExplosion(obj.x, obj.y, 'cyan');
                } else {
                    health--;
                    triggerDamageOverlay();
                    createExplosion(obj.x, obj.y, 'red');
                    if (health <= 0) {
                        gameOver();
                    }
                }
                updateHUD();
                fallingObjects.splice(i, 1);
                continue;
            }

            if (obj.y - obj.radius > canvas.height) {
                fallingObjects.splice(i, 1);
            }
        }

        // Update visual particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= p.decay;
            if (p.alpha <= 0) {
                particles.splice(i, 1);
            }
        }
    }

    // Drawing Game Entities on Canvas
    function renderGame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Draw glowing grid reference
        drawCanvasGridBackground();

        // 2. Draw Falling Objects (orbs)
        fallingObjects.forEach(obj => {
            ctx.save();
            
            const pulse = Math.sin(obj.pulseWave) * 3;
            const size = obj.radius + pulse;
            
            ctx.shadowBlur = obj.glowIntensity;
            
            if (obj.type === 'good') {
                ctx.shadowColor = 'rgba(0, 245, 255, 0.8)';
                
                const gradient = ctx.createRadialGradient(obj.x, obj.y, 1, obj.x, obj.y, size);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.3, '#88faff');
                gradient.addColorStop(1, '#00c3ff');
                ctx.fillStyle = gradient;
            } else {
                ctx.shadowColor = 'rgba(239, 68, 68, 0.9)';
                
                const gradient = ctx.createRadialGradient(obj.x, obj.y, 1, obj.x, obj.y, size);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.2, '#ffa3a3');
                gradient.addColorStop(1, '#ef4444');
                ctx.fillStyle = gradient;
            }
            
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            ctx.save();
            ctx.strokeStyle = obj.type === 'good' ? 'rgba(0, 245, 255, 0.4)' : 'rgba(239, 68, 68, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, size + 5, 0, Math.PI * 2);
            ctx.stroke();
            
            if (obj.type === 'bad') {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(obj.x, obj.y - 6);
                ctx.lineTo(obj.x, obj.y + 6);
                ctx.moveTo(obj.x - 4, obj.y - 1);
                ctx.lineTo(obj.x + 4, obj.y - 1);
                ctx.stroke();
            }
            ctx.restore();
        });

        // 3. Draw particles
        particles.forEach(p => {
            ctx.save();
            ctx.fillStyle = p.color === 'cyan' ? '#00f5ff' : '#ef4444';
            ctx.globalAlpha = p.alpha;
            ctx.shadowBlur = 8;
            ctx.shadowColor = p.color === 'cyan' ? 'var(--neon-cyan)' : 'var(--neon-red)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        // 4. Draw Basket (glowing catcher card)
        if (currentGameState === GAME_STATES.PLAYING || currentGameState === GAME_STATES.PAUSED) {
            ctx.save();
            
            const bx = basket.x - basket.width / 2;
            const by = basket.y;
            const bw = basket.width;
            const bh = basket.height;
            const radius = 10;
            
            const isExpanded = basket.width > BASE_BASKET_WIDTH + 20;
            
            ctx.shadowBlur = isExpanded ? 30 : 20;
            ctx.shadowColor = isExpanded ? 'rgba(0, 255, 255, 0.95)' : 'rgba(0, 245, 255, 0.6)';
            
            const gradient = ctx.createLinearGradient(bx, by, bx, by + bh);
            if (isExpanded) {
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.4, '#00ffff');
                gradient.addColorStop(1, '#007799');
            } else {
                gradient.addColorStop(0, '#00ffff');
                gradient.addColorStop(0.5, '#0087aa');
                gradient.addColorStop(1, '#003e55');
            }
            ctx.fillStyle = gradient;
            
            ctx.beginPath();
            ctx.moveTo(bx + radius, by);
            ctx.lineTo(bx + bw - radius, by);
            ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
            ctx.lineTo(bx + bw, by + bh - radius);
            ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
            ctx.lineTo(bx + radius, by + bh);
            ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
            ctx.lineTo(bx, by + radius);
            ctx.quadraticCurveTo(bx, by, bx + radius, by);
            ctx.closePath();
            ctx.fill();

            // Pinch / Expand Indicator Text on Basket
            if (isExpanded) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 11px Outfit, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('⚡ EXPANDED ⚡', basket.x, by + 14);
            } else {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(bx + 15, by + 4);
                ctx.lineTo(bx + bw - 15, by + 4);
                ctx.stroke();
            }
            
            ctx.restore();
        }
    }

    function drawCanvasGridBackground() {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        
        const step = 40;
        for (let x = 0; x < canvas.width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }

    // ----------------------------------------------------------------------
    // 8. Master Event Loop
    // ----------------------------------------------------------------------
    function animateFrame() {
        updatePhysics();
        renderGame();
        requestAnimationFrame(animateFrame);
    }

    // ----------------------------------------------------------------------
    // 9. Event Listeners & Initialize
    // ----------------------------------------------------------------------
    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', startGame);
    resumeBtn.addEventListener('click', resumeGame);
    
    window.addEventListener('resize', resizeWebcamCanvas);

    initMediaPipe();
    requestAnimationFrame(animateFrame);
});

