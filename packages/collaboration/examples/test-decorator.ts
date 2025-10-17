import 'reflect-metadata';
import { action } from '@d-buckner/ensemble-core';

class TestClass {
  @action
  testMethod() {
    console.log('Method called');
  }
}

console.log('Decorator applied successfully!');
const inst = new TestClass();
inst.testMethod();
