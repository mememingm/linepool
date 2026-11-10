import './config';
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ApiController } from './api.controller';
import { AuthService, SessionGuard } from './auth';
import { DbService } from './db.service';
import { LeasesService } from './leases.service';
import { FulfillmentService } from './fulfillment.service';
import { EventsService } from './events.service';
import { MaintenanceService } from './maintenance.service';
import { settings } from './config';
import { OutboundService } from './outbound.service';
import { PingcodeClient } from './pingcode.client';
import { SendWebhookController } from './send-webhook.controller';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { DemoChatService } from './demo-chat.service';
import { IncomingService, ReceiveWebhookController } from './incoming.service';
import { AdminController, AdminGuard } from './admin.controller';
import { AdminService } from './admin.service';
import { PointsService } from './points.service';
import { PointsController, AdminPointsController } from './points.controller';
import { PaymentGateway } from './payment.gateway';
import { IntegrationService } from './integration.service';
import { IntegrationController } from './integration.controller';
import { OperatorService } from './operator.service';

@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response=host.switchToHttp().getResponse<express.Response>();
    const malformed=error instanceof SyntaxError && 'body' in error;
    const tooLarge=error instanceof Error && 'type' in error && error.type==='entity.too.large';
    const status=error instanceof HttpException ? error.getStatus() : malformed?400:tooLarge?413:500;
    if(status>=500) console.error('API error:',error instanceof Error ? error.name : 'UnknownError');
    const details=error instanceof HttpException ? error.getResponse() : {message:malformed?'Invalid JSON':tooLarge?'Request body too large':'Internal server error'};
    response.status(status).json(typeof details==='string'?{message:details,statusCode:status}:details);
  }
}

@Module({controllers:[ApiController,SendWebhookController,ReceiveWebhookController,ChatController,AdminController,PointsController,AdminPointsController,IntegrationController],providers:[IntegrationService,OperatorService,PaymentGateway,PointsService,DbService,AuthService,SessionGuard,LeasesService,FulfillmentService,EventsService,MaintenanceService,OutboundService,PingcodeClient,IncomingService,ChatService,DemoChatService,AdminService,AdminGuard]})
class AppModule {}

async function bootstrap() {
  const app=await NestFactory.create(AppModule,{bodyParser:false});
  app.use(helmet({contentSecurityPolicy:{directives:{'style-src':["'self'","'unsafe-inline'"],'upgrade-insecure-requests':settings.production?[]:null}},strictTransportSecurity:settings.production?undefined:false}));
  app.use('/api',(_req:express.Request,res:express.Response,next:express.NextFunction)=>{res.setHeader('Cache-Control','no-store');next();});
  app.use((req:express.Request,res:express.Response,next:express.NextFunction)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if(req.get('sec-fetch-site')==='cross-site' || (req.get('origin') && !settings.allowedOrigins.has(req.get('origin')!))) return res.status(403).json({message:'Origin not allowed'});
      if(!req.is('application/json')) return res.status(415).json({message:'Content-Type must be application/json'});
    }
    next();
  });
  app.use(express.json({limit:'32kb',strict:true,verify:(req,_res,body)=>{
    (req as express.Request & {rawBody:Buffer}).rawBody=Buffer.from(body);
  }}));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ApiErrors());
  const server=app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');
  const sourceRoot=resolve(__dirname,'../..');
  const webRoot=existsSync(resolve(sourceRoot,'dist/index.html'))?resolve(sourceRoot,'dist'):sourceRoot;
  for(const file of ['styles.css','favicon.svg']) server.get('/'+file,(_req,res)=>res.sendFile(resolve(webRoot,file)));
  server.get('/',(_req,res)=>res.sendFile(resolve(webRoot,'index.html')));
  server.get('/index.html',(_req,res)=>res.sendFile(resolve(webRoot,'index.html')));
  server.use('/assets',express.static(resolve(webRoot,'assets'),{dotfiles:'deny',index:false}));
  app.enableShutdownHooks();
  await app.listen(settings.port,settings.host);
  console.log('ONCE listening at '+settings.origin+' (demo='+settings.demo+')');
}
bootstrap().catch(error=>{console.error('Startup failed:',error instanceof Error?error.message:'Unknown error');process.exitCode=1;});
