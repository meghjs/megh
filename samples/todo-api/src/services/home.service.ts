import { AppService } from '@meghjs/core';

@AppService
export class HomeService {
  sayHello() {
    return { message: 'Hello World!' };
  }
}
