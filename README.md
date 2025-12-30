<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Descripción

Backend construido con [NestJS](https://nestjs.com/) para exponer un webhook de WhatsApp, enviar mensajes manualmente y consumir la API Graph de Meta. Ahora incluye documentación interactiva con Swagger.

## Project setup

```bash
$ npm install
```

## Configuración requerida

Crear un archivo `.env` en la raíz con las variables:

```
WHATSAPP_API_VERSION=v24.0
WHATSAPP_PHONE_NUMBER_ID=<id_del_numero>
META_API_TOKEN=<token_de_acceso_meta>
WHATSAPP_VERIFY_TOKEN=<token_para_verificacion>
```

### Nuevas funcionalidades: Catálogo de Meta

Para habilitar la sincronización con el catálogo de productos de Meta:

1. Configura el `business_catalog_id` en la tabla `companies` de Supabase
2. El token `META_API_TOKEN` debe tener permisos de catálogo
3. Ver documentación completa en `.github/docs/META_CATALOG_INTEGRATION.md`

Opcionalmente puedes añadir `APP_SECRET` para validar firmas HMAC cuando se implemente.

## Multi-tenant y remitentes

- No existe lista blanca de números entrantes: cualquier remitente que escriba a tu número de WhatsApp Business se registra automáticamente como `CLIENT` en la tabla `company_users` y puede interactuar con los agentes.
- Para designar administradores basta con insertar su número en `company_users` con rol `ADMIN`. Hasta entonces seguirán operando como clientes.
- Las credenciales de Supabase deben usar el puerto `6543` (Supavisor) y puedes proporcionar un certificado raíz propio mediante `SUPABASE_DB_CA_FILE`, `SUPABASE_DB_CA_BASE64` o `SUPABASE_DB_CA_CERT`. Si estás en desarrollo, `SUPABASE_DB_ALLOW_SELF_SIGNED=true` evitará errores por cadenas autofirmadas.

## Ejecutar el proyecto

```bash
# development
$ npm run start

# watch mode (recarga automática)
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Documentación Swagger

Al levantar la aplicación estará disponible en `http://localhost:3000/docs` (ajusta el puerto según tu entorno). Ahí encontrarás los siguientes endpoints documentados:

- `GET /webhook`: verificación usada por Meta.
- `POST /webhook`: recepción de eventos entrantes.
- `POST /webhook/send`: envío de mensajes de texto.
- `POST /webhook/send-image`: envío de imágenes.
- `POST /webhook/send-template`: envío de plantillas aprobadas.

Cada DTO incluye ejemplos y validaciones para facilitar las pruebas desde Swagger UI.

## Ejecutar pruebas

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
# PasaTanda-Smartcontracts
