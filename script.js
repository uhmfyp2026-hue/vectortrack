/* ==============================================================
   VectorTrack Professional - Complete Fixed Version
   With map, speed, and trip storage working
   ============================================================== */

// Wait for DOM and Leaflet to be ready
window.addEventListener('load', function() {
    'use strict';
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded');
        alert('Map library failed to load. Please refresh the page.');
        return;
    }
    
    // ==========================================================
    // DOM Elements
    // ==========================================================
    const elements = {
        startBtn: document.getElementById('startBtn'),
        stopBtn: document.getElementById('stopBtn'),
        resetBtn: document.getElementById('resetBtn'),
        distanceValue: document.getElementById('distanceValue'),
        unitLabel: document.getElementById('unitLabel'),
        speedDisplay: document.getElementById('speedDisplay'),
        currentSpeed: document.getElementById('currentSpeed'),
        maxSpeed: document.getElementById('maxSpeed'),
        statusEl: document.getElementById('status'),
        startCoords: document.getElementById('startCoords'),
        endCoords: document.getElementById('endCoords'),
        ringFill: document.getElementById('ringFill'),
        ringLabel: document.getElementById('ringLabel'),
        pulseDot: document.getElementById('pulseDot'),
        logBody: document.getElementById('logBody'),
        logCountEl: document.getElementById('logCount'),
        tripsBody: document.getElementById('tripsBody'),
        tripsCount: document.getElementById('tripsCount')
    };

    // Verify all elements exist
    for (let [key, element] of Object.entries(elements)) {
        if (!element) {
            console.warn(`Element ${key} not found`);
        }
    }

    // ==========================================================
    // Configuration
    // ==========================================================
    const CONFIG = {
        MIN_DISTANCE: 3,        // Minimum distance change to record (meters)
        MAX_ACCURACY: 50,       // Maximum allowed GPS accuracy (meters)
        RING_MAX: 5000,         // Ring gauge max distance (5km)
        RING_CIRCUMFERENCE: 534, // SVG circle circumference
        UPDATE_INTERVAL: 1000,   // Update UI every second
        MAX_LOG_ENTRIES: 20,     // Maximum log entries to keep
        MAX_TRIPS: 10            // Maximum trips to keep
    };

    // ==========================================================
    // State
    // ==========================================================
    let state = {
        map: null,
        polyline: null,
        marker: null,
        routePath: [],
        watchId: null,
        totalDistance: 0,
        lastPosition: null,
        lastTimestamp: null,
        startTime: null,
        isTracking: false,
        logCount: 0,
        tripCount: 0,
        lastAccuracy: null,
        currentSpeed: 0,
        maxSpeed: 0,
        speedHistory: [],
        trips: []
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
        const speedMs = distanceMeters / timeSeconds;
        return speedMs * 3.6; // Convert to km/h
    }

    /**
     * Format speed for display
     */
    function formatSpeed(speedKmh) {
        if (isNaN(speedKmh) || speedKmh < 0) return '0.0';
        if (speedKmh < 10) return speedKmh.toFixed(1);
        return Math.round(speedKmh).toString();
    }

    /**
     * Format coordinates for display
     */
    function formatCoordinates(lat, lon) {
        if (!lat || !lon) return '—';
        return `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
    }

    /**
     * Format date for display
     */
    function formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 3600000) { // Less than 1 hour
            const mins = Math.floor(diff / 60000);
            return `${mins} min${mins !== 1 ? 's' : ''} ago`;
        } else if (diff < 86400000) { // Less than 24 hours
            const hours = Math.floor(diff / 3600000);
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    /**
     * Update distance display
     */
    function updateDistanceDisplay(meters) {
        if (!elements.distanceValue || !elements.unitLabel) return;
        
        if (meters >= 1000) {
            elements.distanceValue.textContent = (meters / 1000).toFixed(2);
            elements.unitLabel.textContent = 'km';
        } else {
            elements.distanceValue.textContent = meters.toFixed(0);
            elements.unitLabel.textContent = 'm';
        }
    }

    /**
     * Update speed displays
     */
    function updateSpeedDisplay() {
        if (elements.speedDisplay) {
            elements.speedDisplay.textContent = `${formatSpeed(state.currentSpeed)} km/h`;
        }
        if (elements.currentSpeed) {
            elements.currentSpeed.textContent = `${formatSpeed(state.currentSpeed)} km/h`;
        }
        if (elements.maxSpeed) {
            elements.maxSpeed.textContent = `${formatSpeed(state.maxSpeed)} km/h`;
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
        
        if (elements.ringLabel) {
            if (fraction >= 1) {
                elements.ringLabel.textContent = 'MAX';
            } else if (fraction > 0.7) {
                elements.ringLabel.textContent = 'HIGH';
            } else if (fraction > 0.3) {
                elements.ringLabel.textContent = 'ACTIVE';
            }
        }
    }

    /**
     * Update status display
     */
    function updateStatus() {
        if (!elements.statusEl) return;
        
        if (!state.isTracking) {
            elements.statusEl.textContent = 'Ready to track';
            return;
        }
        
        let status = `${formatSpeed(state.currentSpeed)} km/h`;
        if (state.lastAccuracy) {
            status += ` • ±${state.lastAccuracy.toFixed(0)}m`;
        }
        elements.statusEl.textContent = status;
    }

    /**
     * Add entry to activity log
     */
    function addLog(type, message) {
        if (!elements.logBody || !elements.logCountEl) return;
        
        const emptyLog = elements.logBody.querySelector('.log-empty');
        if (emptyLog) emptyLog.remove();
        
        state.logCount++;
        elements.logCountEl.textContent = `${state.logCount} events`;
        
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        entry.innerHTML = `
            <div class="log-dot ${type}"></div>
            <div class="log-content">
                <div class="log-msg">${message}</div>
                <div class="log-time">${time}</div>
            </div>
        `;
        
        elements.logBody.insertBefore(entry, elements.logBody.firstChild);
        
        // Limit log entries
        while (elements.logBody.children.length > CONFIG.MAX_LOG_ENTRIES) {
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
            if (elements.ringLabel) elements.ringLabel.textContent = 'TRACKING';
        } else {
            document.body.classList.remove('tracking');
            if (elements.pulseDot) elements.pulseDot.classList.remove('active');
            if (elements.ringLabel && state.totalDistance > 0) {
                elements.ringLabel.textContent = 'COMPLETE';
            } else {
                elements.ringLabel.textContent = 'READY';
            }
        }
        
        if (elements.startBtn) elements.startBtn.disabled = isTracking;
        if (elements.stopBtn) elements.stopBtn.disabled = !isTracking;
        
        updateStatus();
    }

    // ==========================================================
    // Trip Management
    // ==========================================================
    
    /**
     * Load trips from localStorage
     */
    function loadTrips() {
        try {
            const saved = localStorage.getItem('vectortrack_trips');
            state.trips = saved ? JSON.parse(saved) : [];
            state.tripCount = state.trips.length;
            renderTrips();
        } catch (e) {
            console.error('Failed to load trips:', e);
            state.trips = [];
        }
    }

    /**
     * Save current trip
     */
    function saveTrip() {
        if (state.totalDistance < 10) return; // Don't save very short trips
        
        const trip = {
            id: Date.now(),
            distance: state.totalDistance,
            maxSpeed: state.maxSpeed,
            avgSpeed: state.totalDistance / ((Date.now() - state.startTime) / 1000) * 3.6,
            duration: Date.now() - state.startTime,
            timestamp: new Date().toISOString(),
            startCoords: state.routePath[0],
            endCoords: state.routePath[state.routePath.length - 1]
        };
        
        state.trips.unshift(trip);
        
        // Limit number of trips
        if (state.trips.length > CONFIG.MAX_TRIPS) {
            state.trips = state.trips.slice(0, CONFIG.MAX_TRIPS);
        }
        
        try {
            localStorage.setItem('vectortrack_trips', JSON.stringify(state.trips));
            state.tripCount = state.trips.length;
            renderTrips();
            addLog('system', 'Trip saved');
        } catch (e) {
            console.error('Failed to save trip:', e);
        }
    }

    /**
     * Render trips list
     */
    function renderTrips() {
        if (!elements.tripsBody || !elements.tripsCount) return;
        
        const empty = elements.tripsBody.querySelector('.trips-empty');
        if (empty) empty.remove();
        
        elements.tripsCount.textContent = `${state.tripCount} trip${state.tripCount !== 1 ? 's' : ''}`;
        
        if (state.trips.length === 0) {
            elements.tripsBody.innerHTML = '<div class="trips-empty">No trips recorded yet. Press Start to begin.</div>';
            return;
        }
        
        elements.tripsBody.innerHTML = '';
        
        state.trips.forEach(trip => {
            const distance = trip.distance >= 1000 
                ? `${(trip.distance / 1000).toFixed(2)} km` 
                : `${Math.round(trip.distance)} m`;
            
            const entry = document.createElement('div');
            entry.className = 'trip-entry';
            entry.innerHTML = `
                <div class="trip-info">
                    <div class="trip-distance">${distance}</div>
                    <div class="trip-stats">
                        <span>⌀ ${formatSpeed(trip.avgSpeed)} km/h</span>
                        <span class="trip-max-speed">⬆️ ${formatSpeed(trip.maxSpeed)} km/h</span>
                    </div>
                </div>
                <div class="trip-date">${formatDate(trip.timestamp)}</div>
            `;
            elements.tripsBody.appendChild(entry);
        });
    }

    // ==========================================================
    // Map Functions
    // ==========================================================
    
    /**
     * Initialize map
     */
    function initMap(lat, lon) {
        const mapContainer = document.getElementById('map');
        if (!mapContainer) return false;
        
        // Clear container
        mapContainer.innerHTML = '';
        
        try {
            // Create map
            state.map = L.map('map', {
                center: [lat, lon],
                zoom: 17,
                zoomControl: true,
                attributionControl: true
            });
            
            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap',
                maxZoom: 19
            }).addTo(state.map);
            
            // Add polyline
            state.polyline = L.polyline([], {
                color: '#00f0ff',
                weight: 4,
                opacity: 0.8
            }).addTo(state.map);
            
            // Add marker
            state.marker = L.marker([lat, lon]).addTo(state.map);
            
            // Force map to refresh
            setTimeout(() => {
                if (state.map) {
                    state.map.invalidateSize();
                }
            }, 100);
            
            return true;
        } catch (e) {
            console.error('Map initialization error:', e);
            return false;
        }
    }

    /**
     * Update map with new position
     */
    function updateMap(lat, lon) {
        if (!state.map || !state.polyline || !state.marker) return;
        
        // Update polyline
        state.polyline.addLatLng([lat, lon]);
        
        // Update marker position
        state.marker.setLatLng([lat, lon]);
        
        // Center map on new position
        state.map.setView([lat, lon]);
    }

    // ==========================================================
    // GPS Tracking
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
        state.routePath.push([lat, lon]);
        
        // Update map
        updateMap(lat, lon);
        
        // Calculate distance and speed
        if (state.lastPosition && state.lastTimestamp) {
            const distance = calculateDistance(
                state.lastPosition.lat,
                state.lastPosition.lon,
                lat,
                lon
            );
            
            const timeDiff = (timestamp - state.lastTimestamp) / 1000;
            
            if (distance > CONFIG.MIN_DISTANCE && timeDiff > 0) {
                // Update total distance
                state.totalDistance += distance;
                updateDistanceDisplay(state.totalDistance);
                updateRingProgress(state.totalDistance);
                
                // Calculate speed
                const instantSpeed = calculateSpeed(distance, timeDiff);
                
                // Smooth speed
                state.speedHistory.push(instantSpeed);
                if (state.speedHistory.length > 5) {
                    state.speedHistory.shift();
                }
                state.currentSpeed = state.speedHistory.reduce((a, b) => a + b, 0) / state.speedHistory.length;
                
                // Update max speed
                if (state.currentSpeed > state.maxSpeed) {
                    state.maxSpeed = state.currentSpeed;
                }
                
                // Update displays
                updateSpeedDisplay();
                
                // Log significant speeds
                if (state.currentSpeed > 30 && state.speedHistory.length === 5) {
                    addLog('speed', `Fast speed: ${formatSpeed(state.currentSpeed)} km/h`);
                }
            }
        }
        
        // Update last position
        state.lastPosition = { lat, lon };
        state.lastTimestamp = timestamp;
        state.lastAccuracy = accuracy;
        
        // Update coordinates
        if (elements.endCoords) {
            elements.endCoords.textContent = formatCoordinates(lat, lon);
        }
        
        // Set start coordinates if first point
        if (state.routePath.length === 1 && elements.startCoords) {
            elements.startCoords.textContent = formatCoordinates(lat, lon);
            addLog('start', 'Tracking started');
        }
        
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
            alert('GPS is not supported on this device');
            return;
        }
        
        if (elements.statusEl) {
            elements.statusEl.textContent = 'Acquiring GPS...';
        }
        
        // Reset state
        state.totalDistance = 0;
        state.routePath = [];
        state.lastPosition = null;
        state.lastTimestamp = null;
        state.currentSpeed = 0;
        state.maxSpeed = 0;
        state.speedHistory = [];
        
        updateDistanceDisplay(0);
        updateRingProgress(0);
        updateSpeedDisplay();
        
        // Get initial position
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude: lat, longitude: lon } = position.coords;
                
                // Initialize map
                if (!initMap(lat, lon)) {
                    alert('Failed to initialize map');
                    return;
                }
                
                // Set start coordinates
                if (elements.startCoords) {
                    elements.startCoords.textContent = formatCoordinates(lat, lon);
                }
                
                // Set initial position
                state.lastPosition = { lat, lon };
                state.lastTimestamp = Date.now();
                
                // Start watching position
                state.watchId = navigator.geolocation.watchPosition(
                    handlePosition,
                    handleError,
                    {
                        enableHighAccuracy: true,
                        maximumAge: 0,
                        timeout: 10000
                    }
                );
                
                state.startTime = Date.now();
                updateTrackingState(true);
                addLog('system', 'GPS locked');
            },
            handleError,
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
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
        
        // Save trip
        if (state.totalDistance > 0) {
            saveTrip();
        }
        
        updateTrackingState(false);
        
        if (elements.statusEl) {
            if (state.totalDistance > 0) {
                elements.statusEl.textContent = `Trip saved • Max: ${formatSpeed(state.maxSpeed)} km/h`;
            } else {
                elements.statusEl.textContent = 'Trip cancelled';
            }
        }
        
        addLog('stop', `Trip finished - ${formatSpeed(state.maxSpeed)} km/h max`);
    }

    /**
     * Reset tracking
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
        updateSpeedDisplay();
        
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
    
    // Handle visibility change to refresh map
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && state.map) {
            state.map.invalidateSize();
        }
    });

    // Handle resize for map
    window.addEventListener('resize', function() {
        if (state.map) {
            state.map.invalidateSize();
        }
    });

    // ==========================================================
    // Initialize
    // ==========================================================
    
    // Load trips
    loadTrips();
    
    // Add welcome log
    setTimeout(() => {
        addLog('system', 'VectorTrack ready');
        console.log('VectorTrack initialized successfully');
    }, 500);
});
