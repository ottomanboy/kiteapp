// KiteFlow - Kite Surfing Conditions App
// Uses free NOAA and Weather.gov APIs

class KiteFlow {
    constructor() {
        this.currentLocation = { lat: 41.6868, lon: -70.2428, name: 'Cape Cod, MA' };
        this.weatherData = null;
        this.tideData = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadInitialData();
    }

    setupEventListeners() {
        const searchBtn = document.getElementById('searchBtn');
        const locationInput = document.getElementById('locationInput');
        const quickLocBtns = document.querySelectorAll('.quick-loc');
        const weightInput = document.getElementById('riderWeight');

        searchBtn.addEventListener('click', () => this.handleSearch());
        locationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        quickLocBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const lat = parseFloat(btn.dataset.lat);
                const lon = parseFloat(btn.dataset.lon);
                this.currentLocation = { lat, lon, name: btn.textContent };
                locationInput.value = btn.textContent;
                this.loadInitialData();
            });
        });

        weightInput.addEventListener('input', () => {
            if (this.weatherData) {
                this.calculateKiteSize();
            }
        });
    }

    async handleSearch() {
        const query = document.getElementById('locationInput').value.trim();
        if (!query) return;

        try {
            this.showLoading(true);
            const coords = await this.geocodeLocation(query);
            if (coords) {
                this.currentLocation = { ...coords, name: query };
                await this.loadInitialData();
            }
        } catch (error) {
            this.showError('Location not found. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    async geocodeLocation(query) {
        // Using OpenStreetMap Nominatim API (free, no key required)
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'KiteFlow App'
                }
            });
            const data = await response.json();
            
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon)
                };
            }
            return null;
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    }

    async loadInitialData() {
        try {
            this.showLoading(true);
            this.hideError();

            // Load weather and wind data
            await this.loadWeatherData();
            
            // Load tide data
            await this.loadTideData();
            
            // Update all UI components
            this.updateWindDisplay();
            this.calculateKiteSize();
            this.updateForecast();
            this.updateTideDisplay();
            this.updateSafetyAlerts();
            this.loadPopularSpots();

        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load data. Please check your connection and try again.');
        } finally {
            this.showLoading(false);
        }
    }

    async loadWeatherData() {
        try {
            // First, get the grid point from lat/lon using Weather.gov API
            const pointUrl = `https://api.weather.gov/points/${this.currentLocation.lat},${this.currentLocation.lon}`;
            const pointResponse = await fetch(pointUrl);
            
            if (!pointResponse.ok) {
                throw new Error('Unable to fetch weather point data');
            }
            
            const pointData = await pointResponse.json();
            const forecastUrl = pointData.properties.forecast;
            const hourlyForecastUrl = pointData.properties.forecastHourly;
            const observationUrl = pointData.properties.observationStations;

            // Get current observations
            let observationData = null;
            try {
                const stationsResponse = await fetch(observationUrl);
                const stationsData = await stationsResponse.json();
                
                if (stationsData.features && stationsData.features.length > 0) {
                    const stationUrl = stationsData.features[0].properties.stationIdentifier;
                    const obsUrl = `https://api.weather.gov/stations/${stationUrl}/observations/latest`;
                    const obsResponse = await fetch(obsUrl);
                    if (obsResponse.ok) {
                        observationData = await obsResponse.json();
                    }
                }
            } catch (e) {
                console.warn('Could not fetch observations:', e);
            }

            // Get hourly forecast for wind data
            const hourlyResponse = await fetch(hourlyForecastUrl);
            const hourlyData = await hourlyResponse.json();

            // Get daily forecast
            const forecastResponse = await fetch(forecastUrl);
            const forecastData = await forecastResponse.json();

            this.weatherData = {
                observation: observationData,
                hourlyForecast: hourlyData,
                forecast: forecastData,
                point: pointData
            };

        } catch (error) {
            console.error('Weather API error:', error);
            // Fallback: use mock data or OpenWeatherMap if available
            await this.loadFallbackWeatherData();
        }
    }

    async loadFallbackWeatherData() {
        // Fallback using OpenWeatherMap (requires API key in production)
        // For now, we'll create reasonable mock data based on location
        const season = this.getSeason();
        const baseWind = season === 'winter' ? 18 : 15;
        
        this.weatherData = {
            observation: {
                properties: {
                    temperature: { value: season === 'winter' ? 35 : 72 },
                    windSpeed: { value: baseWind * 0.514444 }, // Convert to m/s
                    windDirection: { value: 270 }, // West wind
                    textDescription: 'Clear'
                }
            },
            hourlyForecast: {
                properties: {
                    periods: this.generateMockHourlyForecast(baseWind)
                }
            }
        };
    }

    generateMockHourlyForecast(baseWind) {
        const hours = [];
        const now = new Date();
        
        for (let i = 0; i < 24; i++) {
            const time = new Date(now.getTime() + i * 3600000);
            const windSpeed = baseWind + (Math.random() * 10 - 5); // Vary ±5 knots
            hours.push({
                startTime: time.toISOString(),
                windSpeed: `${windSpeed.toFixed(0)} mph`,
                windDirection: { value: 270 + (Math.random() * 60 - 30) },
                temperature: 50 + (Math.sin(i / 12 * Math.PI) * 10),
                shortForecast: 'Clear'
            });
        }
        
        return hours;
    }

    getSeason() {
        const month = new Date().getMonth();
        return month >= 11 || month <= 2 ? 'winter' : 'summer';
    }

    async loadTideData() {
        // NOAA Tides API - Using closest station to Cape Cod
        const stationId = '8443970'; // Boston station (closest to Cape Cod)
        const baseUrl = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
        const date = new Date().toISOString().split('T')[0];
        
        try {
            const url = `${baseUrl}?product=predictions&application=NOS.COOPS.TAC.WL&begin_date=${date}&end_date=${date}&datum=MLLW&station=${stationId}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
            
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                this.tideData = data;
            } else {
                throw new Error('Tide data unavailable');
            }
        } catch (error) {
            console.error('Tide API error:', error);
            // Generate mock tide data
            this.tideData = this.generateMockTideData();
        }
    }

    generateMockTideData() {
        const now = new Date();
        const predictions = [];
        
        // Generate 4 tide events (2 high, 2 low) for today
        for (let i = 0; i < 4; i++) {
            const time = new Date(now.getTime() + i * 6 * 3600000);
            const isHigh = i % 2 === 0;
            const type = isHigh ? 'H' : 'L';
            const height = isHigh ? (8.5 + Math.random()) : (0.5 + Math.random());
            
            const timeStr = time.toISOString().split('T')[0] + ' ' + 
                          time.toTimeString().split(' ')[0].substring(0, 5);
            
            predictions.push({
                t: timeStr,
                v: height.toFixed(2),
                type: type
            });
        }
        
        return { predictions };
    }

    updateWindDisplay() {
        if (!this.weatherData || !this.weatherData.observation) {
            return;
        }

        const obs = this.weatherData.observation.properties;
        const windSpeedMs = obs.windSpeed?.value || 0;
        const windSpeedKnots = windSpeedMs * 1.944; // Convert m/s to knots
        const windDirection = obs.windDirection?.value || 0;
        const tempC = obs.temperature?.value || 0;
        const tempF = (tempC * 9/5) + 32;

        // Update wind speed
        document.getElementById('windSpeed').textContent = windSpeedKnots.toFixed(0);
        
        // Update wind direction arrow
        this.updateWindArrow(windDirection);
        document.getElementById('windDirection').textContent = this.getWindDirectionText(windDirection);

        // Update gusts (estimate if not available)
        const gusts = windSpeedKnots * 1.3; // Estimate gusts as 30% higher
        document.getElementById('windGusts').textContent = gusts.toFixed(0);

        // Update temperature
        document.getElementById('temperature').textContent = tempF.toFixed(0);

        // Update condition
        document.getElementById('condition').textContent = obs.textDescription || 'Clear';
    }

    updateWindArrow(direction) {
        const arrow = document.getElementById('windArrow');
        const line = document.getElementById('windLine');
        const triangle = document.getElementById('windTriangle');
        
        if (!line || !triangle) return;

        // Convert wind direction to arrow rotation
        // Wind direction is where wind comes FROM, arrow points that way
        const angle = (direction - 90) * (Math.PI / 180); // Adjust for SVG coordinates
        
        const centerX = 50;
        const centerY = 50;
        const length = 35;
        
        const endX = centerX + Math.cos(angle) * length;
        const endY = centerY + Math.sin(angle) * length;
        
        // Update line
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
        
        // Update triangle (arrowhead)
        const arrowSize = 8;
        const tipX = endX;
        const tipY = endY;
        const baseAngle = angle + Math.PI;
        
        const point1X = tipX + Math.cos(baseAngle + 0.5) * arrowSize;
        const point1Y = tipY + Math.sin(baseAngle + 0.5) * arrowSize;
        const point2X = tipX + Math.cos(baseAngle - 0.5) * arrowSize;
        const point2Y = tipY + Math.sin(baseAngle - 0.5) * arrowSize;
        
        triangle.setAttribute('points', `${tipX},${tipY} ${point1X},${point1Y} ${point2X},${point2Y}`);
    }

    getWindDirectionText(degrees) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 
                           'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return directions[index];
    }

    calculateKiteSize() {
        if (!this.weatherData) return;

        const weight = parseFloat(document.getElementById('riderWeight').value) || 180;
        const obs = this.weatherData.observation?.properties;
        const windSpeedMs = obs?.windSpeed?.value || 0;
        const windSpeedKnots = windSpeedMs * 1.944;

        if (windSpeedKnots === 0) {
            document.querySelector('.size-number').textContent = '--';
            document.getElementById('kiteRecommendation').textContent = 'No wind data available';
            return;
        }

        // Kite size calculation based on weight and wind speed
        // General formula: base kite size depends on weight, adjusted by wind speed
        const baseSize = weight / 10; // Base size in m²
        const windAdjustment = (15 - windSpeedKnots) / 3; // Adjust for wind speed
        let kiteSize = baseSize + windAdjustment;

        // Clamp between reasonable limits
        kiteSize = Math.max(6, Math.min(18, kiteSize));

        document.querySelector('.size-number').textContent = kiteSize.toFixed(1);
        
        // Recommendation text
        let recommendation = '';
        if (windSpeedKnots < 12) {
            recommendation = 'Wind too light. Consider waiting or using a foil kite.';
        } else if (windSpeedKnots > 35) {
            recommendation = 'Wind too strong. Expert riders only with small kites.';
        } else if (windSpeedKnots >= 12 && windSpeedKnots <= 20) {
            recommendation = 'Perfect conditions! Great for learning and cruising.';
        } else {
            recommendation = 'Strong wind - experienced riders recommended.';
        }

        document.getElementById('kiteRecommendation').textContent = recommendation;

        // Update wind status indicator
        const statusIndicator = document.querySelector('.status-indicator');
        const statusText = document.querySelector('.status-text');
        
        if (windSpeedKnots < 12) {
            statusIndicator.className = 'status-indicator';
            statusText.textContent = 'Light wind conditions';
        } else if (windSpeedKnots > 35) {
            statusIndicator.className = 'status-indicator danger';
            statusText.textContent = 'Very strong wind - be cautious';
        } else if (windSpeedKnots >= 12 && windSpeedKnots <= 25) {
            statusIndicator.className = 'status-indicator good';
            statusText.textContent = 'Ideal kiting conditions!';
        } else {
            statusIndicator.className = 'status-indicator warning';
            statusText.textContent = 'Strong wind - experienced kiters only';
        }
    }

    updateForecast() {
        if (!this.weatherData || !this.weatherData.hourlyForecast) {
            return;
        }

        const periods = this.weatherData.hourlyForecast.properties.periods.slice(0, 24);
        const canvas = document.getElementById('forecastCanvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        // Extract wind speeds
        const windSpeeds = periods.map(p => {
            const speedStr = p.windSpeed || '0 mph';
            const speed = parseFloat(speedStr);
            return speed * 0.868976; // Convert mph to knots
        });

        const maxWind = Math.max(...windSpeeds, 25);
        const minWind = Math.min(...windSpeeds, 5);
        const range = maxWind - minWind || 1;

        const width = canvas.width;
        const height = canvas.height;
        const padding = 40;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
            
            // Labels
            ctx.fillStyle = '#666';
            ctx.font = '12px Inter';
            ctx.textAlign = 'right';
            const value = maxWind - (range / 5) * i;
            ctx.fillText(value.toFixed(0) + 'kts', padding - 10, y + 4);
        }

        // Draw wind speed line
        ctx.strokeStyle = '#0099ff';
        ctx.lineWidth = 3;
        ctx.beginPath();

        periods.forEach((period, index) => {
            const x = padding + (chartWidth / (periods.length - 1)) * index;
            const normalizedSpeed = (windSpeeds[index] - minWind) / range;
            const y = padding + chartHeight - (normalizedSpeed * chartHeight);
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw points
        ctx.fillStyle = '#0099ff';
        periods.forEach((period, index) => {
            const x = padding + (chartWidth / (periods.length - 1)) * index;
            const normalizedSpeed = (windSpeeds[index] - minWind) / range;
            const y = padding + chartHeight - (normalizedSpeed * chartHeight);
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        // Draw time labels
        ctx.fillStyle = '#666';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        periods.forEach((period, index) => {
            if (index % 6 === 0) {
                const x = padding + (chartWidth / (periods.length - 1)) * index;
                const time = new Date(period.startTime);
                const timeStr = time.getHours() + ':00';
                ctx.fillText(timeStr, x, height - padding + 20);
            }
        });
    }

    updateTideDisplay() {
        if (!this.tideData || !this.tideData.predictions) {
            document.getElementById('tideSchedule').innerHTML = '<p>Tide data unavailable</p>';
            return;
        }

        const predictions = this.tideData.predictions;
        const now = new Date();
        
        // Find next tide event
        let nextTide = null;
        for (const pred of predictions) {
            const tideTime = new Date(pred.t + ':00');
            if (tideTime > now) {
                nextTide = pred;
                break;
            }
        }

        if (nextTide) {
            const tideTime = new Date(nextTide.t + ':00');
            const isHigh = nextTide.type === 'H';
            
            document.getElementById('tidePhase').textContent = isHigh ? 'High Tide' : 'Low Tide';
            document.getElementById('tideTime').textContent = tideTime.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        }

        // Display all tide events
        let scheduleHtml = '<div class="tide-events">';
        predictions.forEach(pred => {
            const tideTime = new Date(pred.t + ':00');
            const isHigh = pred.type === 'H';
            const type = isHigh ? 'High' : 'Low';
            const icon = isHigh ? '↑' : '↓';
            
            scheduleHtml += `
                <div class="tide-event">
                    <span>${icon} ${type} Tide</span>
                    <span>${tideTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                    <span>${pred.v} ft</span>
                </div>
            `;
        });
        scheduleHtml += '</div>';
        
        document.getElementById('tideSchedule').innerHTML = scheduleHtml;
    }

    loadPopularSpots() {
        const spots = [
            { name: 'Kalmus Beach, Cape Cod', location: 'Hyannis, MA', description: 'Popular winter kiting spot, best with NW winds', wind: 'NW-NE' },
            { name: 'Corpus Christi Beach', location: 'Texas', description: 'Year-round kiting paradise', wind: 'SE-SW' },
            { name: 'Hatteras Island', location: 'Outer Banks, NC', description: 'World-class conditions, consistent winds', wind: 'SW-NE' },
            { name: 'Maui Kite Beach', location: 'Hawaii', description: 'Tropical kiting with consistent trade winds', wind: 'NE' },
            { name: 'Sherman Island', location: 'Sacramento Delta, CA', description: 'Strong consistent winds, shallow water', wind: 'W-SW' }
        ];

        let spotsHtml = '';
        spots.forEach(spot => {
            spotsHtml += `
                <div class="spot-item" onclick="app.searchSpot('${spot.name}')">
                    <div class="spot-name">${spot.name}</div>
                    <div class="spot-info">${spot.location} • Best winds: ${spot.wind}</div>
                    <div class="spot-info" style="font-size: 0.85rem; margin-top: 5px;">${spot.description}</div>
                </div>
            `;
        });

        document.getElementById('spotsList').innerHTML = spotsHtml;
    }

    searchSpot(spotName) {
        document.getElementById('locationInput').value = spotName;
        this.handleSearch();
    }

    updateSafetyAlerts() {
        if (!this.weatherData) return;

        const obs = this.weatherData.observation?.properties;
        const windSpeedMs = obs?.windSpeed?.value || 0;
        const windSpeedKnots = windSpeedMs * 1.944;
        const tempC = obs?.temperature?.value || 0;
        const tempF = (tempC * 9/5) + 32;

        let alertsHtml = '';

        // Wind speed alerts
        if (windSpeedKnots < 10) {
            alertsHtml += '<div class="alert warning">⚠️ Wind too light for safe kiting. Consider waiting for better conditions.</div>';
        } else if (windSpeedKnots > 35) {
            alertsHtml += '<div class="alert danger">🚨 Very strong wind! Expert riders only. Consider postponing your session.</div>';
        } else if (windSpeedKnots >= 12 && windSpeedKnots <= 25) {
            alertsHtml += '<div class="alert info">✅ Excellent conditions! Perfect for kiting.</div>';
        }

        // Temperature alerts (for winter kiting)
        if (tempF < 32) {
            alertsHtml += '<div class="alert warning">🥶 Freezing temperatures! Ensure proper cold-water gear and safety equipment.</div>';
        } else if (tempF < 50) {
            alertsHtml += '<div class="alert info">🧊 Cold conditions. Wear appropriate wetsuit and safety gear.</div>';
        }

        // General safety reminders
        alertsHtml += '<div class="alert info">💡 Always check local conditions, inform someone of your location, and kite within your limits.</div>';

        document.getElementById('safetyAlerts').innerHTML = alertsHtml;

        // Update checklist
        const checklistItems = document.querySelectorAll('.conditions-checklist li');
        checklistItems.forEach(item => {
            const text = item.textContent;
            if (text.includes('Wind speed') && windSpeedKnots >= 12 && windSpeedKnots <= 35) {
                item.classList.add('checked');
            } else if (text.includes('Wind speed')) {
                item.classList.remove('checked');
            }
        });
    }

    showLoading(show) {
        document.getElementById('loading').classList.toggle('hidden', !show);
        document.getElementById('mainContent').style.opacity = show ? '0.5' : '1';
    }

    showError(message) {
        const errorDiv = document.getElementById('error');
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }

    hideError() {
        document.getElementById('error').classList.add('hidden');
    }
}

// Initialize app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new KiteFlow();
    
    // Update tide display after a short delay
    setTimeout(() => {
        if (app.tideData) {
            app.updateTideDisplay();
        }
    }, 1000);
});

