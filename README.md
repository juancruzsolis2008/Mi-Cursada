# Cursada

App web para organizarse en la facultad: calendario, pendientes, horarios, resúmenes vinculados a Google Docs y progreso de la carrera. Es HTML/CSS/JS puro (sin build step), lista para subir a GitHub Pages o cualquier hosting estático.

## 1. Crear el proyecto de Firebase

1. Andá a [console.firebase.google.com](https://console.firebase.google.com) → **Crear proyecto**.
2. Dentro del proyecto, agregá una **app web** (ícono `</>`) → copiá el objeto `firebaseConfig` que te muestra.
3. Pegalo en `js/config.js`, reemplazando los valores de ejemplo.

## 2. Habilitar Google Sign-In

**Authentication → Sign-in method → Google → Habilitar.** Elegí un mail de soporte y guardá.

Si vas a desplegar en un dominio (GitHub Pages, Vercel, etc.), agregalo en **Authentication → Settings → Authorized domains**.

## 3. Crear la base de Firestore

**Firestore Database → Crear base de datos** → modo producción → elegí una región (ej. `southamerica-east1`, la más cercana a Argentina).

Después pegá estas reglas en **Firestore → Reglas**, reemplazando lo que haya por defecto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Esto hace que cada usuario solo pueda leer y escribir sus propios datos (todo vive bajo `/users/{uid}/...`). El mismo texto está en `firestore.rules` por si preferís copiarlo desde ahí.

## 4. Probar en local

Como usa `fetch` de módulos externos (Firebase por CDN), alcanza con abrir `index.html` con un servidor local simple, por ejemplo:

```
npx serve .
```

o la extensión "Live Server" de VS Code. (Abrir el archivo directo con doble clic puede fallar por CORS en algunos navegadores).

## 5. Subir a GitHub / desplegar

1. Creá el repo en GitHub y subí esta carpeta tal cual.
2. Para GitHub Pages: **Settings → Pages → Deploy from branch → main → /(root)**.
3. Una vez que tengas la URL de GitHub Pages, agregala en **Authorized domains** (paso 2) para que el login con Google funcione ahí también.

## Estructura de datos en Firestore

```
users/{uid}
  carrera: { nombre, universidad }
  materias/{materiaId}   → { nombre, color, horarios: [{dia, inicio, fin, aula}], docs: [{titulo, url}] }
  pendientes/{id}        → { titulo, materiaId, fecha, prioridad, link, completado }
  plan/{id}              → { nombre, anio, cuatrimestre, estado, nota, correlativas: [planId,...] }
```

`dia` en los horarios va de `1` (lunes) a `6` (sábado).
`estado` en el plan: `no_cursada` · `cursando` · `regular` · `promocionada` · `aprobada`.

## Cosas a saber / próximos pasos posibles

- El botón "Crear resumen nuevo ↗" abre un Google Doc en blanco (no lo ubica en una carpeta específica ni lo renombra automáticamente); eso requeriría sumar la API de Google Drive con permisos aparte. Por ahora, lo simple es crear el Doc, renombrarlo y pegar el link en la app.
- El calendario semanal muestra los horarios fijos de cursada (8 a 22 hs, lunes a sábado). El calendario mensual muestra pendientes/entregas por día.
- Las correlativas del plan son opcionales: si no las cargás, simplemente no se bloquea ninguna materia.
