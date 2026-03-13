/* ==============================================================
   VectorTrack Professional - Distance Tracker
   Fixed with proper speed calculation
   ============================================================== */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    'use strict';
    
    // ==========================================================
    // DOM Elements
    // ==========================================================
    const elements = {
        startBtn: document.getElementById('startBtn'),
        stopBtn: document.getElementById('stopBtn'),
        resetBtn: document.getElementById('resetBtn'),
        distanceValue: document.getElementById('distanceValue'),
        unitLabel: document.getElementById('unitLabel'),
        statusEl: document.getElementById('status'),
        startCoords: document.getElementById('startCoords'),
        endCoords: document.getElementById('endCoords'),
        ringFill: document.getElementById('ringFill'),
        ringLabel: document.getElementById('ringLabel'),
        pulseDot: document.getElementById('pulseDot'),
        logBody: document.getElementById('logBody'),
        logCountEl: document.getElementById('logCount')
    };

    // ==========================================================
    // Configuration
    // ==========================================================
    const CONFIG = {
        MIN_DISTANCE: 3,        // Minimum distance change to record (meters)
        MAX_ACCURACY: 30,       // Maximum allowed GPS accuracy (meters)
        RING_MAX: 5000,         // Ring gauge max distance (5km)
        RING_CIRCUMFERENCE: 534, // SVG circle circumference
        SPEED_SMOOTHING: 0.3    // Speed smoothing factor (0-1)
    };

    // ==========================================================
    // State
    // ==========================================================
    let state = {
        map: null,
        polyline: null,
        routePath: [],
        watchId: null,
        totalDistance: 0,
        lastPosition: null,
        lastTimestamp: null,
        startTime: null,
        isTracking: false,
        logCount: 0,
        lastAccuracy: null,
        currentSpeed: 0,
        maxSpeed: 0,
        speedHistory: []
    };

    // ==========================================================
    // Utility Functions
    // ==========================================================
    
    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                 Math.cos(φ1) * Math.cos(φ2) *
                 Math.sin(Δλ/2) * Math.sin(Δλ/2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Calculate speed in km/h from distance and time
     */
    function calculateSpeed(distanceMeters, timeSeconds) {
        if (timeSeconds <= 0) return 0;
        const speedMs = distanceMeters / timeSeconds; // meters per second
        return speedMs * 3.6; // Convert to km/h
    }

    /**
     * Smooth speed value using exponential moving average
     */
    function smoothSpeed(newSpeed) {
        if (state.speedHistory.length === 0) return newSpeed;
        
        // Add to history
        state.speedHistory.push(newSpeed);
        if (state.speedHistory.length > 5) {
            state.speedHistory.shift();
        }
        
        // Calculate weighted average (more recent = higher weight)
        let totalWeight = 0;
        let weightedSum = 0;
        
        for (let i = 0; i < state.speedHistory.length; i++) {
            const weight = i + 1; // Later entries have higher weight
            weightedSum += state.speedHistory[i] * weight;
            totalWeight += weight;
        }
        
        return weightedSum / totalWeight;
    }

    /**
     * Format coordinates for display
     */
    function formatCoordinates(lat, lon) {
        if (!lat || !lon) return '—';
        return `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
    }

    /**
     * Format speed for display
     */
    function formatSpeed(speedKmh) {
        if (speedKmh < 0.1) return '0.0 km/h';
        if (speedKmh < 10) return speedKmh.toFixed(1) + ' km/h';
        return Math.round(speedKmh) + ' km/h';
    }

    /**
     * Update distance display with appropriate units
     */
    function updateDistanceDisplay(meters) {
        if (!elements.distanceValue || !elements.unitLabel) return;
        
        if (meters >= 1000) {
            elements.distanceValue.textContent = (meters / 1000).toFixed(3);
            elements.unitLabel.textContent = 'km';
        } else {
            elements.distanceValue.textContent = meters.toFixed(1);
            elements.unitLabel.textContent = 'm';
        }
    }

    /**
     * Update ring gauge progress
     */
    function updateRingProgress(distance) {
        if (!elements.ringFill) return;
        
        const fraction = Math.min(distance / CONFIG.RING_MAX, 1);
        const offset = CONFIG.RING_CIRCUMFERENCE * (1 - fraction);
        elements.ringFill.style.strokeDashoffset = offset;
        
        // Update ring label based on progress
        if (elements.ringLabel) {
            if (fraction >= 1) {
                elements.ringLabel.textContent = 'MAX';
                elements.ringLabel.style.color = 'var(--magenta)';
            } else if (fraction > 0.7) {
                elements.ringLabel.textContent = 'HIGH';
                elements.ringLabel.style.color = 'var(--lime)';
            } else if (fraction > 0.3) {
                elements.ringLabel.textContent = 'ACTIVE';
                elements.ringLabel.style.color = 'var(--cyan)';
            }
        }
    }

    /**
     * Update status display with speed
     */
    function updateStatus() {
        if (!elements.statusEl) return;
        
        if (!state.isTracking) {
            elements.statusEl.textContent = 'Ready to track';
            return;
        }
        
        const speedText = formatSpeed(state.currentSpeed);
        const accuracyText = state.lastAccuracy ? ` ±${state.lastAccuracy.toFixed(0)}m` : '';
        
        if (state.maxSpeed > 0) {
            elements.statusEl.textContent = `${speedText} • Max: ${formatSpeed(state.maxSpeed)}${accuracyText}`;
        } else {
            elements.statusEl.textContent = `${speedText}${accuracyText}`;
        }
    }

    /**
     * Add entry to activity log
     */
    function addLog(type, message, speed = null) {
        if (!elements.logBody || !elements.logCountEl) return;
        
        // Remove empty state if present
        const emptyLog = elements.logBody.querySelector('.log-empty');
        if (emptyLog) emptyLog.remove();
        
        // Increment log count
        state.logCount++;
        elements.logCountEl.textContent = `${state.logCount} events`;
        
        // Create log entry
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        let displayMessage = message;
        if (speed !== null) {
            displayMessage += ` • ${formatSpeed(speed)}`;
        }
        
        entry.innerHTML = `
            <div class="log-dot ${type}"></div>
            <div class="log-content">
                <div class="log-msg">${displayMessage}</div>
                <div class="log-time">${time}</div>
            </div>
        `;
        
        elements.logBody.prepend(entry);
        
        // Limit log entries
        while (elements.logBody.children.length > 20) {
            elements.logBody.removeChild(elements.logBody.lastChild);
        }
    }

    /**
     * Update tracking state UI
     */
    function updateTrackingState(isTracking) {
        state.isTracking = isTracking;
        
        if (isTracking) {
            document.body.classList.add('tracking');
            if (elements.pulseDot) elements.pulseDot.classList.add('active');
            if (elements.ringLabel) {
                elements.ringLabel.textContent = 'TRACKING';
                elements.ringLabel.style.color = '';
            }
        } else {
            document.body.classList.remove('tracking');
            if (elements.pulseDot) elements.pulseDot.classList.remove('active');
            if (elements.ringLabel) {
                elements.ringLabel.textContent = 'READY';
                elements.ringLabel.style.color = '';
            }
        }
        
        // Update button states
        if (elements.startBtn) elements.startBtn.disabled = isTracking;
        if (elements.stopBtn) elements.stopBtn.disabled = !isTracking;
        
        updateStatus();
    }

    // ==========================================================
    // Map Functions
    // ==========================================================
    
    /**
     * Initialize map
     */
    function initMap(lat, lon) {
        // Check if Leaflet is available
        if (typeof L === 'undefined') {
            console.error('Leaflet not loaded');
            addLog('error', 'Map library failed to load');
            return false;
        }
        
        // Remove existing map if any
        if (state.map) {
            state.map.remove();
            state.map = null;
        }
        
        // Create new map
        state.map = L.map('map').setView([lat, lon], 17);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(state.map);
        
        // Initialize polyline
        state.polyline = L.polyline(state.routePath, {
            color: '#00f0ff',
            weight: 4,
            opacity: 0.8
        }).addTo(state.map);
        
        // Add marker
        L.marker([lat, lon]).addTo(state.map);
        
        return true;
    }

    // ==========================================================
    // GPS Tracking Functions
    // ==========================================================
    
    /**
     * Handle position update
     */
    function handlePosition(position) {
        const { latitude: lat, longitude: lon, accuracy, timestamp } = position.coords;
        
        // Filter poor accuracy
        if (accuracy > CONFIG.MAX_ACCURACY) {
            updateStatus();
            return;
        }
        
        // Add point to route
        const point = [lat, lon];
        state.routePath.push(point);
        
        // Update polyline
        if (state.polyline) {
            state.polyline.setLatLngs(state.routePath);
            if (state.map) state.map.setView(point);
        }
        
        // Calculate distance and speed
        if (state.lastPosition && state.lastTimestamp) {
            const distance = calculateDistance(
                state.lastPosition.lat,
                state.lastPosition.lon,
                lat,
                lon
            );
            
            const timeDiff = (timestamp - state.lastTimestamp) / 1000; // Convert to seconds
            
            if (distance > CONFIG.MIN_DISTANCE && timeDiff > 0) {
                // Update total distance
                state.totalDistance += distance;
                updateDistanceDisplay(state.totalDistance);
                updateRingProgress(state.totalDistance);
                
                // Calculate instant speed
                const instantSpeed = calculateSpeed(distance, timeDiff);
                
                // Smooth the speed
                state.currentSpeed = smoothSpeed(instantSpeed);
                
                // Update max speed
                if (state.currentSpeed > state.maxSpeed) {
                    state.maxSpeed = state.currentSpeed;
                    addLog('speed', 'New max speed', state.maxSpeed);
                }
                
                // Log significant speed changes
                if (state.currentSpeed > 20 && state.speedHistory.length < 10) {
                    addLog('speed', 'Moving fast', state.currentSpeed);
                }
            }
        }
        
        // Update last position and timestamp
        state.lastPosition = { lat, lon };
        state.lastTimestamp = timestamp;
        
        // Update accuracy
        state.lastAccuracy = accuracy;
        
        // Update coordinates display
        if (elements.endCoords) {
            elements.endCoords.textContent = formatCoordinates(lat, lon);
        }
        
        // Set start coordinates if this is the first point
        if (state.routePath.length === 1 && elements.startCoords) {
            elements.startCoords.textContent = formatCoordinates(lat, lon);
            addLog('start', 'Tracking started');
        }
        
        // Update status with speed
        updateStatus();
    }

    /**
     * Handle GPS error
     */
    function handleError(error) {
        let message = 'GPS error';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Location permission denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Position unavailable';
                break;
            case error.TIMEOUT:
                message = 'GPS timeout';
                break;
        }
        
        if (elements.statusEl) elements.statusEl.textContent = message;
        addLog('error', message);
    }

    // ==========================================================
    // Event Handlers
    // ==========================================================
    
    /**
     * Start tracking
     */
    function startTracking() {
        if (!navigator.geolocation) {
            alert('GPS not supported on this device');
            return;
        }
        
        if (elements.statusEl) {
            elements.statusEl.textContent = 'Acquiring GPS...';
        }
        
        // Reset state for new session
        state.totalDistance = 0;
        state.routePath = [];
        state.lastPosition = null;
        state.lastTimestamp = null;
        state.currentSpeed = 0;
        state.maxSpeed = 0;
        state.speedHistory = [];
        
        updateDistanceDisplay(0);
        updateRingProgress(0);
        
        // Get initial position
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude: lat, longitude: lon, timestamp } = position.coords;
                
                // Initialize map
                if (!initMap(lat, lon)) {
                    return;
                }
                
                // Set start coordinates
                if (elements.startCoords) {
                    elements.startCoords.textContent = formatCoordinates(lat, lon);
                }
                
                // Set initial position
                state.lastPosition = { lat, lon };
                state.lastTimestamp = timestamp;
                
                // Start watching position
                state.watchId = navigator.geolocation.watchPosition(
                    handlePosition,
                    handleError,
                    {
                        enableHighAccuracy: true,
                        maximumAge: 0,
                        timeout: 8000
                    }
                );
                
                state.startTime = Date.now();
                updateTrackingState(true);
                addLog('system', 'GPS locked');
            },
            handleError,
            {
                enableHighAccuracy: true,
                timeout: 10000
            }
        );
    }

    /**
     * Stop tracking
     */
    function stopTracking() {
        if (state.watchId) {
            navigator.geolocation.clearWatch(state.watchId);
            state.watchId = null;
        }
        
        // Calculate average speed
        const duration = (Date.now() - state.startTime) / 1000; // seconds
        const avgSpeed = (state.totalDistance / duration) * 3.6; // km/h
        
        updateTrackingState(false);
        
        if (elements.ringLabel) {
            elements.ringLabel.textContent = 'COMPLETE';
            elements.ringLabel.style.color = 'var(--magenta)';
        }
        
        if (elements.statusEl) {
            elements.statusEl.textContent = `Trip completed • Avg: ${formatSpeed(avgSpeed)} • Max: ${formatSpeed(state.maxSpeed)}`;
        }
        
        // Save trip data
        saveTripData({
            distance: state.totalDistance,
            maxSpeed: state.maxSpeed,
            avgSpeed: avgSpeed,
            duration: duration,
            timestamp: new Date().toISOString()
        });
        
        addLog('stop', `Trip finished - Max: ${formatSpeed(state.maxSpeed)}`, state.maxSpeed);
    }

    /**
     * Reset session
     */
    function resetTracking() {
        // Stop tracking if active
        if (state.watchId) {
            navigator.geolocation.clearWatch(state.watchId);
            state.watchId = null;
        }
        
        // Reset state
        state.totalDistance = 0;
        state.routePath = [];
        state.lastPosition = null;
        state.lastTimestamp = null;
        state.currentSpeed = 0;
        state.maxSpeed = 0;
        state.speedHistory = [];
        
        // Update UI
        updateDistanceDisplay(0);
        updateRingProgress(0);
        
        if (elements.startCoords) elements.startCoords.textContent = '—';
        if (elements.endCoords) elements.endCoords.textContent = '—';
        if (elements.statusEl) elements.statusEl.textContent = 'Ready to track';
        
        // Clear map
        if (state.map) {
            state.map.remove();
            state.map = null;
        }
        
        updateTrackingState(false);
        addLog('reset', 'Session reset');
    }

    // ==========================================================
    // Data Persistence
    // ==========================================================
    
    /**
     * Save trip data to localStorage
     */
    function saveTripData(tripData) {
        try {
            let trips = JSON.parse(localStorage.getItem('vectortrack_trips')) || [];
            trips.push({
                ...tripData,
                id: Date.now(),
                date: new Date().toLocaleDateString()
            });
            
            // Keep only last 20 trips
            if (trips.length > 20) {
                trips = trips.slice(-20);
            }
            
            localStorage.setItem('vectortrack_trips', JSON.stringify(trips));
            addLog('system', 'Trip saved to history');
        } catch (e) {
            console.error('Failed to save trip:', e);
        }
    }

    // ==========================================================
    // Event Listeners
    // ==========================================================
    
    if (elements.startBtn) {
        elements.startBtn.addEventListener('click', startTracking);
    }
    
    if (elements.stopBtn) {
        elements.stopBtn.addEventListener('click', stopTracking);
    }
    
    if (elements.resetBtn) {
        elements.resetBtn.addEventListener('click', resetTracking);
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Space to start/stop (only if not typing in an input)
        if (e.code === 'Space' && !e.repeat && !e.target.matches('input, textarea, button')) {
            e.preventDefault();
            if (state.isTracking) {
                stopTracking();
            } else {
                startTracking();
            }
        }
        
        // R to reset (with Ctrl/Cmd)
        if ((e.code === 'KeyR') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            resetTracking();
        }
    });

    // ==========================================================
    // Initialize
    // ==========================================================
    
    // Add welcome log
    setTimeout(() => {
        addLog('system', 'VectorTrack ready');
        console.log('VectorTrack initialized with speed tracking');
    }, 500);
});
