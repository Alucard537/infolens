// Crea public/ejemplo/prueba-ar.usdz: una válvula sencilla (unos 20 cm) para probar el AR con LiDAR.
// Uso: node scripts/generar-prueba-ar.mjs
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

const azul = new THREE.MeshStandardMaterial({ color: 0x7ec8f2, metalness: 0.3, roughness: 0.5 });
const gris = new THREE.MeshStandardMaterial({ color: 0x9aa5ad, metalness: 0.6, roughness: 0.4 });
const rojo = new THREE.MeshStandardMaterial({ color: 0xe04b3c, metalness: 0.1, roughness: 0.6 });
const valvula = new THREE.Group();
const cuerpo = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 16), azul);
cuerpo.position.y = 0.06;
const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 32), gris);
tubo.rotation.z = Math.PI / 2; tubo.position.y = 0.06;
const vastago = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 16), gris);
vastago.position.y = 0.13;
const palanca = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.025), rojo);
palanca.position.set(0.04, 0.16, 0);
const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.08), gris);
base.position.y = 0.005;
valvula.add(cuerpo, tubo, vastago, palanca, base);
const bytes = await new USDZExporter().parseAsync(valvula);
writeFileSync(new URL('../public/ejemplo/prueba-ar.usdz', import.meta.url), Buffer.from(bytes));
console.log('prueba-ar.usdz:', bytes.byteLength, 'bytes');
