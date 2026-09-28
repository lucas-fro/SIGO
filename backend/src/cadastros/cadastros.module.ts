import { Module } from '@nestjs/common'
import { CadastrosController } from './cadastros.controller.js'
import { CadastrosService } from './cadastros.service.js'

@Module({
  controllers: [CadastrosController],
  providers: [CadastrosService],
})
export class CadastrosModule {}
