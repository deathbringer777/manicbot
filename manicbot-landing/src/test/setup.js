import '@testing-library/jest-dom';
import './../i18n';

if (typeof IntersectionObserver === 'undefined') {
  global.IntersectionObserver = class IntersectionObserver {
    constructor(cb) {
      this.cb = cb;
      this.observe = () => {
        setTimeout(() => this.cb([{ isIntersecting: true }]), 0);
      };
      this.disconnect = () => {};
    }
  };
}
