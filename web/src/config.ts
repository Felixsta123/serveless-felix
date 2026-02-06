// Firebase and API configuration
export const config = {
  // Firebase config (from Firebase Console)
  firebase: {
    apiKey: 'AIzaSyDtV-y83u0o8xvp3ChbMsKSMeFrta8F0lI',
    authDomain: 'serverless-felix-dev.firebaseapp.com',
    projectId: 'serverless-felix-dev',
    storageBucket: 'serverless-felix-dev.firebasestorage.app',
    messagingSenderId: '1098968211229',
    appId: '1:1098968211229:web:e418b9a850b112a9528bf4',
  },

  // API Gateway URL
  apiGateway: 'https://serverless-felix-dev-gateway-e0uxaqsd.ew.gateway.dev',

  // Canvas settings
  chunkSize: 50,      // Pixels per chunk dimension
  pixelSize: 10,      // Display size of each pixel
  canvasSize: 500,    // Canvas element size in pixels
};
