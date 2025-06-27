const swaggerJSDoc = require('swagger-jsdoc');
const mongooseToSwagger = require('mongoose-to-swagger');
const SalesOrder = require('./model/salesOrder');
const Invoice = require('./model/invoice');

const swaggerDefinition = {
  openapi: '3.0.0', // ✅ Corrected version
  info: {
    title: 'Bizbooks Sales Service API',
    version: '1.0.0',
    description: 'Bizbooks Sales Service API',
  },
  components: {
    schemas: {
        SalesOrder: mongooseToSwagger(SalesOrder),
        Invoice: mongooseToSwagger(Invoice),
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: ['./routes/*.js'], // Ensure you have proper JSDoc comments in this path
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
