import 'reflect-metadata';
import { action } from '../../core/src/core/decorators.js';

class TestClass {
  @action
  testMethod() {
    console.log('Method called');
  }
}

console.log('Decorator applied successfully!');
const inst = new TestClass();
inst.testMethod();
