/* ==============================================================
   VectorTrack Professional — Enhanced Edition
   Advanced distance tracking with premium features
   ============================================================== */

// Core variables
let map;
let polyline;
let routePath = [];
let watchID = null;
let totalDistance = 0;
let lastPosition = null;
let startTime = null;
let sessionTrips = [];
let currentSpeed = 0;
let maxSpeed = 0;
let altitude = null;

// DOM Elements
const elements = {
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    resetBtn: document.getElementById("resetBtn"),
    distanceValue: document.getElementById("distanceValue"),
    unitLabel: document.getElementById("unitLabel"),
    statusEl: document.getElementById("status"),
    startCoords: document.getElementById("startCoords"),
    endCoords: document.getElementById("endCoords"),
    ringFill: document.getElementById("ringFill"),
    ringLabel: document.getElementById("ringLabel"),
    pulseDot: document.getElementById("pulseDot"),
    logBody: document.getElementById("logBody"),
    logCountEl: document.getElementById("logCount")
};

// Configuration
const CONFIG = {
    MIN_DISTANCE: 3,        // Minimum distance to record (meters)
    MAX_ACCURACY: 25,       // Maximum allowed GPS accuracy
    RING_CIRCUMFERENCE: 534, // SVG circle circumference
    MAX_RING_DISTANCE: 5000, // 5km max for ring gauge
    SMOOTHING_FACTOR: 0.3    // Speed smoothing factor
};

// State
let state = {
    isTracking: false,
    logCount: 0,
    lastSpeed: 0
};

/* ==============================================================
   UTILITY FUNCTIONS
   ============================================================== */

/**
 * Calculate distance between two coordinates using Haversine formula
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
    
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Format coordinates for display
 */
function formatCoordinates(lat, lon) {
    return `${lat.toFixed(6)}°, ${lon.toFixed(6)}°`;
}

/**
 * Format duration nicely
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Calculate speed in km/h
 */
function calculateSpeed(distance, timeDelta) {
    if (timeDelta <= 0) return 0;
    const speedMs = distance / timeDelta; // meters per second
    return speedMs * 3.6; // km/h
}

/* ==============================================================
   DISPLAY FUNCTIONS
   ============================================================== */

/**
 * Update distance display with proper units
 */
function updateDistanceDisplay(meters) {
    if (meters >= 1000) {
        elements.distanceValue.textContent = (meters / 1000).toFixed(3);
        elements.unitLabel.textContent = "km";
    } else {
        elements.distanceValue.textContent = meters.toFixed(1);
        elements.unitLabel.textContent = "m";
    }
}

/**
 * Update ring gauge progress
 */
function updateRingProgress(distance) {
    const fraction = Math.min(distance / CONFIG.MAX_RING_DISTANCE, 1);
    const offset = CONFIG.RING_CIRCUMFERENCE * (1 - fraction);
    elements.ringFill.style.strokeDashoffset = offset;
    
    // Update ring label based on progress
    if (fraction >= 1) {
        elements.ringLabel.textContent = "MAX";
        elements.ringLabel.style.color = "var(--magenta-primary)";
    } else if (fraction > 0.7) {
        elements.ringLabel.textContent = "HIGH";
        elements.ringLabel.style.color = "var(--lime-primary)";
    } else if (fraction > 0.3) {
        elements.ringLabel.textContent = "ACTIVE";
        elements.ringLabel.style.color = "var(--cyan-primary)";
    }
}

/**
 * Update UI based on tracking state
 */
function updateTrackingState(isTracking) {
    state.isTracking = isTracking;
    
    if (isTracking) {
        document.body.classList.add('tracking');
        elements.pulseDot.classList.add('active');
        elements.statusEl.textContent = "GPS Locked • Tracking";
        elements.ringLabel.textContent = "TRACKING";
    } else {
        document.body.classList.remove('tracking');
        elements.pulseDot.classList.remove('active');
    }
    
    // Update button states
    elements.startBtn.disabled = isTracking;
    elements.stopBtn.disabled = !isTracking;
}

/* ==============================================================
   LOG SYSTEM
   ============================================================== */

/**
 * Add entry to activity log
 */
function addLog(type, message, data = {}) {
    const emptyLog = elements.logBody.querySelector(".log-empty");
    if (emptyLog) emptyLog.remove();
    
    state.logCount++;
    elements.logCountEl.textContent = `${state.logCount} events`;
    
    const entry = document.createElement("div");
    entry.className = "log-entry";
    
    const time = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    let details = '';
    if (data.distance) {
        details = ` • ${data.distance.toFixed(1)}m`;
    } else if (data.speed) {
        details = ` • ${data.speed.toFixed(1)}km/h`;
    }
    
    entry.innerHTML = `
        <div class="log-dot ${type}"></div>
        <div class="log-content">
            <div class="log-msg">${message}${details}</div>
            <div class="log-time">${time}</div>
        </div>
    `;
    
    elements.logBody.prepend(entry);
    
    // Limit log entries
    while (elements.logBody.children.length > 20) {
        elements.logBody.removeChild(elements.logBody.lastChild);
    }
}

/* ==============================================================
   MAP FUNCTIONS
   ============================================================== */

/**
 * Initialize map with given coordinates
 */
function initMap(lat, lon) {
    if (map) {
        map.remove();
    }
    
    map = L.map('map').setView([lat, lon], 18);
    
    // Premium map tiles with custom styling
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '©CartoDB',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    // Initialize polyline
    polyline = L.polyline(routePath, {
        color: '#00f0ff',
        weight: 4,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 1
    }).addTo(map);
    
    // Add custom marker for current position
    const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            width: 12px;
            height: 12px;
            background: #00f0ff;
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 0 20px #00f0ff;
        "></div>`,
        iconSize: [12, 12]
    });
    
    L.marker([lat, lon], { icon: customIcon }).addTo(map);
}

/* ==============================================================
   GPS TRACKING
   ============================================================== */

/**
 * Handle successful position update
 */
function trackPosition(position) {
    const { latitude: lat, longitude: lon, accuracy, altitude: alt } = position.coords;
    
    // Filter poor accuracy
    if (accuracy > CONFIG.MAX_ACCURACY) {
        elements.statusEl.textContent = `Low accuracy (${accuracy.toFixed(0)}m)`;
        return;
    }
    
    // Update altitude
    if (alt !== null) {
        altitude = alt;
    }
    
    const point = [lat, lon];
    routePath.push(point);
    
    // Update polyline
    if (polyline) {
        polyline.setLatLngs(routePath);
        map.setView(point);
        
        // Add marker for significant points
        if (routePath.length % 10 === 0) {
            const checkpointIcon = L.divIcon({
                className: 'checkpoint-marker',
                html: `<div style="
                    width: 6px;
                    height: 6px;
                    background: rgba(255,45,117,0.8);
                    border-radius: 50%;
                "></div>`,
                iconSize: [6, 6]
            });
            L.marker(point, { icon: checkpointIcon }).addTo(map);
        }
    }
    
    // Distance calculation
    if (lastPosition) {
        const distance = calculateDistance(
            lastPosition.lat,
            lastPosition.lon,
            lat,
            lon
        );
        
        if (distance > CONFIG.MIN_DISTANCE) {
            totalDistance += distance;
            updateDistanceDisplay(totalDistance);
            updateRingProgress(totalDistance);
            
            // Calculate speed
            const timeDelta = 1000; // Assuming 1 second between updates
            const speed = calculateSpeed(distance, timeDelta);
            
            // Smooth speed
            currentSpeed = currentSpeed * CONFIG.SMOOTHING_FACTOR + 
                          speed * (1 - CONFIG.SMOOTHING_FACTOR);
            
            // Update max speed
            if (currentSpeed > maxSpeed) {
                maxSpeed = currentSpeed;
            }
            
            // Update status with speed
            elements.statusEl.textContent = `${currentSpeed.toFixed(1)} km/h • ⬆️ ${maxSpeed.toFixed(1)} km/h`;
        }
    }
    
    lastPosition = { lat, lon };
    
    // Update coordinates display
    if (routePath.length === 1) {
        elements.startCoords.textContent = formatCoordinates(lat, lon);
    }
    elements.endCoords.textContent = formatCoordinates(lat, lon);
}

/**
 * Handle GPS error
 */
function gpsError(error) {
    let message = "GPS Error";
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = "Location access denied";
            break;
        case error.POSITION_UNAVAILABLE:
            message = "Position unavailable";
            break;
        case error.TIMEOUT:
            message = "GPS timeout";
            break;
    }
    
    elements.statusEl.textContent = message;
    addLog("error", message);
}

/* ==============================================================
   EVENT HANDLERS
   ============================================================== */

/**
 * Start tracking
 */
elements.startBtn.onclick = () => {
    if (!navigator.geolocation) {
        alert("GPS not supported on this device");
        return;
    }
    
    elements.statusEl.textContent = "Acquiring GPS signal...";
    addLog("start", "Tracking session initiated");
    
    // Reset for new session
    totalDistance = 0;
    routePath = [];
    currentSpeed = 0;
    maxSpeed = 0;
    
    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude: lat, longitude: lon } = position.coords;
            
            elements.startCoords.textContent = formatCoordinates(lat, lon);
            routePath.push([lat, lon]);
            
            initMap(lat, lon);
            
            lastPosition = { lat, lon };
            startTime = Date.now();
            
            // Start watching position
            watchID = navigator.geolocation.watchPosition(
                trackPosition, 
                gpsError, 
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 8000
                }
            );
            
            updateTrackingState(true);
            addLog("gps", "GPS locked", { accuracy: position.coords.accuracy });
        },
        gpsError,
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
};

/**
 * Stop tracking
 */
elements.stopBtn.onclick = () => {
    if (watchID) {
        navigator.geolocation.clearWatch(watchID);
        watchID = null;
    }
    
    const duration = Date.now() - startTime;
    const avgSpeed = (totalDistance / (duration / 1000)) * 3.6;
    
    // Save trip
    const trip = {
        distance: totalDistance,
        avgSpeed: avgSpeed,
        maxSpeed: maxSpeed,
        duration: duration,
        startTime: startTime,
        endTime: Date.now(),
        path: routePath
    };
    
    sessionTrips.push(trip);
    saveTrip(trip);
    
    elements.endCoords.textContent = formatCoordinates(
        lastPosition.lat,
        lastPosition.lon
    );
    
    elements.statusEl.textContent = `Trip completed • ⌀ ${avgSpeed.toFixed(1)} km/h`;
    elements.ringLabel.textContent = "COMPLETE";
    
    updateTrackingState(false);
    addLog("stop", "Trip finished", { 
        distance: totalDistance,
        speed: avgSpeed 
    });
};

/**
 * Reset session
 */
elements.resetBtn.onclick = () => {
    // Stop tracking if active
    if (watchID) {
        navigator.geolocation.clearWatch(watchID);
        watchID = null;
    }
    
    // Reset all data
    totalDistance = 0;
    routePath = [];
    lastPosition = null;
    currentSpeed = 0;
    maxSpeed = 0;
    altitude = null;
    
    // Update UI
    updateDistanceDisplay(0);
    updateRingProgress(0);
    elements.startCoords.textContent = "—";
    elements.endCoords.textContent = "—";
    elements.statusEl.textContent = "Ready to track";
    elements.ringLabel.textContent = "READY";
    
    // Clear map
    if (map) {
        map.remove();
        map = null;
    }
    
    updateTrackingState(false);
    addLog("reset", "Session reset");
};

/* ==============================================================
   TRIP STORAGE
   ============================================================== */

/**
 * Save trip to localStorage
 */
function saveTrip(trip) {
    try {
        let trips = JSON.parse(localStorage.getItem("vectorTrips")) || [];
        trips.push({
            ...trip,
            date: new Date().toISOString(),
            id: Date.now()
        });
        
        // Keep only last 50 trips
        if (trips.length > 50) {
            trips = trips.slice(-50);
        }
        
        localStorage.setItem("vectorTrips", JSON.stringify(trips));
        addLog("save", "Trip saved to history");
    } catch (e) {
        console.error("Failed to save trip:", e);
    }
}

/**
 * Load trip history
 */
function loadTripHistory() {
    try {
        const trips = JSON.parse(localStorage.getItem("vectorTrips")) || [];
        if (trips.length > 0) {
            const lastTrip = trips[trips.length - 1];
            addLog("history", `Last trip: ${(lastTrip.distance / 1000).toFixed(2)}km`);
        }
    } catch (e) {
        console.error("Failed to load trip history:", e);
    }
}

/* ==============================================================
   KEYBOARD SHORTCUTS
   ============================================================== */
document.addEventListener('keydown', (e) => {
    // Spacebar to start/stop
    if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (state.isTracking) {
            elements.stopBtn.click();
        } else {
            elements.startBtn.click();
        }
    }
    
    // R key to reset
    if (e.code === 'KeyR' && e.ctrlKey) {
        e.preventDefault();
        elements.resetBtn.click();
    }
});

/* ==============================================================
   INITIALIZATION
   ============================================================== */

/**
 * Initialize the app
 */
function init() {
    console.log("🚀 VectorTrack Professional initialized");
    
    // Load trip history
    loadTripHistory();
    
    // Check for service worker
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("service-worker.js")
            .then(reg => console.log("✅ Service Worker registered"))
            .catch(err => console.error("❌ Service Worker failed:", err));
    }
    
    // Add welcome log
    setTimeout(() => {
        addLog("system", "VectorTrack ready", {});
    }, 1000);
    
    // Check if device supports GPS
    if (!navigator.geolocation) {
        addLog("error", "GPS not supported");
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
