// Datos ficticios pero verosimiles: ventas mensuales por region (miles de
// euros), ejercicio 2025. Cada trimestre suma EXACTAMENTE las cifras
// trimestrales de los demas paneles del banco (p. ej. Andalucia
// Ene+Feb+Mar = 312 = su T1 2025), para mantener la coherencia del conjunto.
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const REGIONES = [
  "Andalucía",
  "Cataluña",
  "Comunidad de Madrid",
  "Comunidad Valenciana",
  "Galicia",
  "País Vasco"
];

const NOMBRES_CORTOS = ["Andalucía", "Cataluña", "Madrid", "C. Valenciana", "Galicia", "P. Vasco"];

const VENTAS_MENSUALES = {
  "Andalucía":            [98, 102, 112, 110, 116, 122, 101, 96, 98, 121, 128, 142],
  "Cataluña":             [136, 142, 150, 148, 151, 156, 133, 130, 138, 160, 168, 184],
  "Comunidad de Madrid":  [124, 128, 137, 130, 133, 139, 127, 122, 127, 146, 153, 169],
  "Comunidad Valenciana": [78, 81, 88, 83, 86, 90, 99, 100, 102, 90, 95, 103],
  "Galicia":              [56, 58, 62, 54, 55, 59, 62, 63, 65, 64, 68, 73],
  "País Vasco":           [68, 71, 75, 74, 76, 80, 66, 64, 68, 77, 81, 88]
};

// Numero de escalones de la escala secuencial. Valor por defecto: 3.
// Para las pruebas del capitulo cinco puede alternarse SIN editar este
// archivo abriendo el panel con ?clases=5 en la direccion (index.html lee
// el parametro); la rampa base tiene 5 tonos y rampaParaClases los
// equiespacia.
const NUM_CLASES = 3;

// Rampa DELIBERADAMENTE hostil al daltonismo: semaforo del rojo al verde
// pasando por amarillo. Se aplica en los atributos fill de las celdas
// (nivel 1 de extraccion): el proposito del panel es que la extension la
// detecte como problematica y proponga una rampa perceptualmente uniforme.
const RAMPA_SEMAFORO = ["#C62828", "#EF6C00", "#FBC02D", "#8BC34A", "#2E7D32"];

// Escalones equiespaciados de la rampa para el numero de clases elegido.
// Con NUM_CLASES = 3 devuelve #C62828 (rojo), #FBC02D (amarillo) y
// #2E7D32 (verde); con 5, la rampa completa.
function rampaParaClases(numClases) {
  if (numClases <= 1) return [RAMPA_SEMAFORO[0]];
  const colores = [];
  for (let k = 0; k < numClases; k += 1) {
    colores.push(RAMPA_SEMAFORO[Math.round((k * (RAMPA_SEMAFORO.length - 1)) / (numClases - 1))]);
  }
  return colores;
}
