import { ApiController, Get } from '@meghjs/core';
import { HomeService } from '../services/home.service';

@ApiController('/')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  sayHello() {
    return this.homeService.sayHello();
  }
}
