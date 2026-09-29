import { Module } from '@nestjs/common'
import { CadastrosController } from './cadastros.controller.js'
import { CadastrosService } from './cadastros.service.js'
import { CartoesController } from './cartoes.controller.js'
import { CartoesService } from './cartoes.service.js'

@Module({
  controllers: [CadastrosController, CartoesController],
  providers: [CadastrosService, CartoesService],
})
export class CadastrosModule {}
