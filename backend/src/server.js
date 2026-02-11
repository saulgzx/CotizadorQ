require('dotenv').config();

require('./app');
const { startServer } = require('./routes/legacyRoutes');

startServer();
