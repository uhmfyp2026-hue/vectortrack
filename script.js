/* ===== VectorTrack Professional GPS Tracker ===== */

let startLat=null,startLon=null;
let watchID=null;
let map;
let routePath=[];
let polyline;

let totalDistance=0;
let lastPosition=null;
let startTime=null;

/* ===== ELEMENTS ===== */

const startBtn=document.getElementById("startBtn");
const stopBtn=document.getElementById("stopBtn");
const resetBtn=document.getElementById("resetBtn");

const distVal=document.getElementById("distanceValue");
const unitLabel=document.getElementById("unitLabel");

const statusEl=document.getElementById("status");
const ringFill=document.getElementById("ringFill");

const startCoords=document.getElementById("startCoords");
const endCoords=document.getElementById("endCoords");

const logBody=document.getElementById("logBody");
const logCountEl=document.getElementById("logCount");

const ringLabel=document.getElementById("ringLabel");

const RING_CIRCUMFERENCE=534;

/* ===== GEO ===== */

function getPosition(){

return new Promise((resolve,reject)=>{

navigator.geolocation.getCurrentPosition(resolve,reject,{
enableHighAccuracy:true,
timeout:10000,
maximumAge:0
});

});

}



function calculateDistance(lat1,lon1,lat2,lon2){

const R=6371e3;

const φ1=lat1*Math.PI/180;
const φ2=lat2*Math.PI/180;

const Δφ=(lat2-lat1)*Math.PI/180;
const Δλ=(lon2-lon1)*Math.PI/180;

const a=
Math.sin(Δφ/2)*Math.sin(Δφ/2)+
Math.cos(φ1)*Math.cos(φ2)*
Math.sin(Δλ/2)*Math.sin(Δλ/2);

return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));

}

/* ===== MAP ===== */

function initMap(lat,lon){

map=new google.maps.Map(document.getElementById("map"),{
zoom:16,
center:{lat:lat,lng:lon}
});

polyline=new google.maps.Polyline({
path:routePath,
strokeColor:"#00e5b4",
strokeOpacity:1,
strokeWeight:4
});

polyline.setMap(map);

}

/* ===== DISPLAY ===== */

function displayDistance(meters){

if(meters>=1000){

distVal.textContent=(meters/1000).toFixed(3);
unitLabel.textContent="km";

}else{

distVal.textContent=meters.toFixed(2);
unitLabel.textContent="m";

}

}

function setRingProgress(frac){

const offset=RING_CIRCUMFERENCE*(1-Math.min(frac,1));

ringFill.style.strokeDashoffset=offset;

}

function setStatus(text){

statusEl.textContent=text;

}

function initMap(lat, lon) {

map = L.map('map').setView([lat, lon], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

polyline = L.polyline(routePath, {
    color: '#00e5b4',
    weight: 4
}).addTo(map);

}

/* ===== LOG ===== */

let logCount=0;

function addLog(type,msg){

const empty=logBody.querySelector(".log-empty");

if(empty) empty.remove();

logCount++;

logCountEl.textContent=logCount+" events";

const entry=document.createElement("div");

entry.className="log-entry";

entry.innerHTML=`
<div class="log-dot ${type}"></div>
<div class="log-content">
<div class="log-msg">${msg}</div>
<div class="log-time">${new Date().toLocaleTimeString()}</div>
</div>`;

logBody.prepend(entry);

}

/* ===== START TRACKING ===== */

startBtn.onclick=async()=>{

try{

const pos=await getPosition();

startLat=pos.coords.latitude;
startLon=pos.coords.longitude;

startCoords.textContent=`${startLat.toFixed(5)}, ${startLon.toFixed(5)}`;

initMap(startLat,startLon);

startTime=Date.now();

lastPosition={lat:startLat,lon:startLon};

watchID=navigator.geolocation.watchPosition(position=>{

const lat = position.coords.latitude;
const lon = position.coords.longitude;

const newPoint = [lat, lon];

routePath.push(newPoint);

polyline.setLatLngs(routePath);

map.setView(newPoint);

const d=calculateDistance(
lastPosition.lat,
lastPosition.lon,
lat,
lon
);

totalDistance+=d;

lastPosition={lat,lon};

displayDistance(totalDistance);

const speed=position.coords.speed;

if(speed){

ringLabel.textContent=(speed*3.6).toFixed(1)+" km/h";

}

setRingProgress(totalDistance/5000);

});

startBtn.disabled=true;
stopBtn.disabled=false;

addLog("start","Tracking started");

setStatus("Tracking active");

}catch(err){

setStatus("GPS error: "+err.message);

}

};

/* ===== STOP ===== */

stopBtn.onclick=()=>{

navigator.geolocation.clearWatch(watchID);

const duration=(Date.now()-startTime)/1000;

const avgSpeed=(totalDistance/duration)*3.6;

endCoords.textContent="Trip Completed";

saveTrip(totalDistance,avgSpeed);

addLog("stop","Trip finished");

startBtn.disabled=false;
stopBtn.disabled=true;

};

/* ===== RESET ===== */

resetBtn.onclick=()=>{

totalDistance=0;

routePath=[];

displayDistance(0);

setRingProgress(0);

startCoords.textContent="—";
endCoords.textContent="—";

ringLabel.textContent="READY";

addLog("reset","Session reset");

};

/* ===== TRIPS ===== */

function saveTrip(distance,speed){

let trips=JSON.parse(localStorage.getItem("vectorTrips"))||[];

trips.push({
distance:distance,
speed:speed,
date:new Date().toLocaleString()
});

localStorage.setItem("vectorTrips",JSON.stringify(trips));

}

/* ===== PWA ===== */

if("serviceWorker" in navigator){

navigator.serviceWorker.register("service-worker.js");

}