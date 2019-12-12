import { start } from 'ember-qunit';
import { setApplication } from '@ember/test-helpers';
import Application from '../app';
import config from '../config/environment';
import TestAdapter from './test-adapter';

Application.initializer({
  name: `99-override-adapter`,
  initialize(app) {
    app.register('adapter:main', TestAdapter);
  }
});

setApplication(Application.create(config.APP));
window.NO_EMBER_DEBUG = true;
start();
