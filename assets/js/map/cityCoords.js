/**
 * cityCoords.js — Indian city / state → [lat, lng] lookup.
 *
 * Maps city names and state capitals to coordinates so company
 * records (which have city + state but no lat/lng) can be placed
 * on the map without an external geocoding API.
 */

const STATE_CAPITALS = {
  'Andhra Pradesh':    [15.9129, 80.2167],
  'Arunachal Pradesh': [27.0844, 93.6053],
  'Assam':             [26.1445, 91.7362],
  'Bihar':             [25.6093, 85.1376],
  'Chhattisgarh':      [21.2514, 81.6296],
  'Goa':               [15.4909, 73.8278],
  'Gujarat':           [23.2156, 72.6369],
  'Haryana':           [30.7333, 76.7794],
  'Himachal Pradesh':  [31.1048, 77.1734],
  'Jharkhand':         [23.3441, 85.3096],
  'Karnataka':         [12.9716, 77.5946],
  'Kerala':            [8.5241, 76.9366],
  'Madhya Pradesh':    [23.2599, 77.4126],
  'Maharashtra':       [19.0760, 72.8777],
  'Manipur':           [24.8170, 93.9368],
  'Meghalaya':         [25.5788, 91.8933],
  'Mizoram':           [23.7271, 92.7176],
  'Nagaland':          [25.6747, 94.1086],
  'Odisha':            [20.2961, 85.8245],
  'Punjab':            [30.7333, 76.7794],
  'Rajasthan':         [26.9124, 75.7873],
  'Sikkim':            [27.3389, 88.6065],
  'Tamil Nadu':        [13.0827, 80.2707],
  'Telangana':         [17.3850, 78.4867],
  'Tripura':           [23.8315, 91.2868],
  'Uttar Pradesh':     [26.8468, 80.9462],
  'Uttarakhand':       [30.3165, 78.0322],
  'West Bengal':       [22.5726, 88.3639],
  'Delhi':             [28.6139, 77.2090],
  'Chandigarh':        [30.7333, 76.7794],
  'Puducherry':        [11.9416, 79.8083],
  'Jammu and Kashmir': [34.0837, 74.7973],
  'Ladakh':            [34.1526, 77.5771],
  'Andaman and Nicobar Islands': [11.7401, 92.6586],
  'Dadra and Nagar Haveli and Daman and Diu': [20.3974, 72.8328],
  'Lakshadweep':       [10.5667, 72.6417],
};

const CITY_COORDS = {
  'Mumbai':          [19.0760, 72.8777],
  'Navi Mumbai':     [19.0330, 73.0297],
  'Thane':           [19.2183, 72.9781],
  'Delhi':           [28.6139, 77.2090],
  'New Delhi':       [28.6139, 77.2090],
  'Gurugram':        [28.4595, 77.0266],
  'Gurgaon':         [28.4595, 77.0266],
  'Noida':           [28.5355, 77.3910],
  'Bengaluru':       [12.9716, 77.5946],
  'Bangalore':       [12.9716, 77.5946],
  'Chennai':         [13.0827, 80.2707],
  'Hyderabad':       [17.3850, 78.4867],
  'Kolkata':         [22.5726, 88.3639],
  'Pune':            [18.5204, 73.8567],
  'Ahmedabad':       [23.0225, 72.5714],
  'Jaipur':          [26.9124, 75.7873],
  'Lucknow':         [26.8468, 80.9462],
  'Chandigarh':      [30.7333, 76.7794],
  'Bhopal':          [23.2599, 77.4126],
  'Indore':          [22.7196, 75.8577],
  'Vadodara':        [22.3072, 73.1812],
  'Surat':           [21.1702, 72.8311],
  'Nagpur':          [21.1458, 79.0882],
  'Kochi':           [9.9312, 76.2673],
  'Thiruvananthapuram': [8.5241, 76.9366],
  'Coimbatore':      [11.0168, 76.9558],
  'Visakhapatnam':   [17.6868, 83.2185],
  'Vijayawada':      [16.5062, 80.6480],
  'Bhubaneswar':     [20.2961, 85.8245],
  'Patna':           [25.6093, 85.1376],
  'Ranchi':          [23.3441, 85.3096],
  'Raipur':          [21.2514, 81.6296],
  'Guwahati':        [26.1445, 91.7362],
  'Dehradun':        [30.3165, 78.0322],
  'Shimla':          [31.1048, 77.1734],
  'Panaji':          [15.4909, 73.8278],
  'Imphal':          [24.8170, 93.9368],
  'Shillong':        [25.5788, 91.8933],
  'Aizawl':          [23.7271, 92.7176],
  'Kohima':          [25.6747, 94.1086],
  'Agartala':        [23.8315, 91.2868],
  'Gangtok':         [27.3389, 88.6065],
  'Itanagar':        [27.0844, 93.6053],
  'Srinagar':        [34.0837, 74.7973],
  'Jammu':           [32.7266, 74.8570],
  'Leh':             [34.1526, 77.5771],
  'Puducherry':      [11.9416, 79.8083],
  'Pondicherry':     [11.9416, 79.8083],
  'Amritsar':        [31.6340, 74.8723],
  'Ludhiana':        [30.9010, 75.8573],
  'Jalandhar':       [31.3260, 75.5762],
  'Mangaluru':       [12.9141, 74.8560],
  'Mangalore':       [12.9141, 74.8560],
  'Mysuru':          [12.2958, 76.6394],
  'Mysore':          [12.2958, 76.6394],
  'Hubli':           [15.3647, 75.1240],
  'Nashik':          [20.0063, 73.7900],
  'Aurangabad':      [19.8762, 75.3433],
  'Rajkot':          [22.3039, 70.8022],
  'Jodhpur':         [26.2389, 73.0243],
  'Udaipur':         [24.5854, 73.7125],
  'Kota':            [25.2138, 75.8648],
  'Varanasi':        [25.3176, 82.9739],
  'Kanpur':          [26.4499, 80.3319],
  'Agra':            [27.1767, 78.0081],
  'Allahabad':       [25.4358, 81.8463],
  'Prayagraj':       [25.4358, 81.8463],
  'Meerut':          [28.9845, 77.7064],
  'Ghaziabad':       [28.6692, 77.4538],
  'Faridabad':       [28.4089, 77.3178],
  'Jabalpur':        [23.1815, 79.9864],
  'Gwalior':         [26.2183, 78.1828],
  'Tiruchirappalli': [10.7905, 78.7047],
  'Madurai':         [9.9252, 78.1198],
  'Salem':           [11.6643, 78.1460],
  'Warangal':        [17.9784, 79.5941],
  'Guntur':          [16.3067, 80.4365],
  'Cuttack':         [20.4625, 85.8830],
  'Jamshedpur':      [22.8046, 86.2029],
  'Dhanbad':         [23.7957, 86.4304],
  'Siliguri':        [26.7271, 88.6393],
  'Durgapur':        [23.5204, 87.3119],
  'Asansol':         [23.6888, 86.9661],
  'Thrissur':        [10.5276, 76.2144],
  'Kozhikode':       [11.2588, 75.7804],
  'Calicut':         [11.2588, 75.7804],
  'Kollam':          [8.8932, 76.6141],
  'Gandhinagar':     [23.2156, 72.6369],
  'Anand':           [22.5645, 72.9289],
  'Bharuch':         [21.6949, 72.9781],
  'Jamnagar':        [22.4707, 70.0577],
  'Bhavnagar':       [21.7645, 72.1519],
  'Junagadh':        [21.5222, 70.4579],
  'Morbi':           [22.8173, 70.8378],
  'Bhuj':            [23.2420, 69.6669],
  'Mehsana':         [23.5880, 72.3693],
  'Nadiad':          [22.6916, 72.8634],
  'Palanpur':        [24.1722, 72.4383],
  'Valsad':          [20.5992, 72.9342],
  'Navsari':         [20.9467, 72.9520],
  'Amreli':          [21.6032, 71.2216],
  'Patan':           [23.8493, 72.1266],
  'Godhra':          [22.7788, 73.6143],
  'Porbandar':       [21.6417, 69.6293],
  'Botad':           [22.1704, 71.6666],
  'Surendranagar':   [22.7196, 71.6369],
  'Vapi':            [20.3893, 72.9106],
  'Bikaner':         [28.0229, 73.3119],
  'Ajmer':           [26.4499, 74.6399],
  'Bareilly':        [28.3670, 79.4304],
  'Moradabad':       [28.8389, 78.7769],
  'Aligarh':         [27.8974, 78.0880],
  'Gorakhpur':       [26.7606, 83.3732],
  'Mathura':         [27.4924, 77.6737],
  'Mangaluru':       [12.9141, 74.8560],
  'Nellore':         [14.4426, 79.9865],
  'Tirupati':        [13.6288, 79.4192],
  'Rajahmundry':     [17.0005, 81.8040],
  'Kakinada':        [16.9891, 82.2475],
  'Secunderabad':    [17.4399, 78.4983],
  'Ernakulam':       [9.9816, 76.2999],
  'Trivandrum':      [8.5241, 76.9366],
};

/**
 * Resolve coordinates for a company record.
 * Priority: city match → state capital → India center.
 */
export function getCoords(city, state) {
  if (city) {
    const c = city.trim();
    if (CITY_COORDS[c]) return CITY_COORDS[c];

    const lower = c.toLowerCase();
    for (const [name, coords] of Object.entries(CITY_COORDS)) {
      if (name.toLowerCase() === lower) return coords;
    }
  }

  if (state) {
    const s = state.trim();
    if (STATE_CAPITALS[s]) return STATE_CAPITALS[s];

    const lower = s.toLowerCase();
    for (const [name, coords] of Object.entries(STATE_CAPITALS)) {
      if (name.toLowerCase() === lower) return coords;
    }
  }

  // India center fallback with small random jitter to avoid stacking
  return [22.5 + (Math.random() - 0.5) * 2, 78.9 + (Math.random() - 0.5) * 2];
}

export { STATE_CAPITALS, CITY_COORDS };
