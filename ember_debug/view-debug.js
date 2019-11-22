/* eslint no-cond-assign:0 */
import PortMixin from 'ember-debug/mixins/port-mixin';
import RenderTree from 'ember-debug/libs/render-tree';
import ViewInspection from 'ember-debug/libs/view-inspection';

const Ember = window.Ember;

const {
  computed,
  run,
  Object: EmberObject,
} = Ember;
const { backburner } = run;
const { readOnly } = computed;

export default EmberObject.extend(PortMixin, {
  namespace: null,

  adapter: readOnly('namespace.adapter'),
  objectInspector: readOnly('namespace.objectInspector'),

  portNamespace: 'view',

  messages: {
    getTree() {
      this.sendTree();
    },

    showPreview({ id }) {
      this.viewInspection.show(id, false);
      // this.renderTree.highlightLayer(message.objectId || message.elementId, true);
    },

    hidePreview() {
      this.viewInspection.hide();
    },

    inspectViews({ inspect }) {
      if (inspect) {
        this.startInspecting();
      } else {
        this.stopInspecting();
      }
    },

    scrollIntoView({ id }) {
      this.renderTree.scrollIntoView(id);
    },

    inspectElement({ id }) {
      this.renderTree.inspectElement(id);
    },

    contextMenu() {
      let { lastRightClicked } = this;
      this.lastRightClicked = null;
      this.inspectNearest(lastRightClicked);
    }
  },

  init() {
    this._super(...arguments);

    this.retainedObjects = [];

    let renderTree = this.renderTree = new RenderTree({
      owner: this.getOwner(),
      retainObject: this.retainObject.bind(this),
      inspectNode: this.inspectNode.bind(this),
    });

    this.viewInspection = new ViewInspection({
      renderTree,
      objectInspector: this.objectInspector,
      didStop: this.didStopInspecting.bind(this),
    });

    this.setupListeners();
  },

  setupListeners() {
    this.lastRightClicked = null;
    this.onRightClick = this.onRightClick.bind(this);
    window.addEventListener('mousedown', this.onRightClick);

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.resizeHandler);

    this.scheduledSendTree = null;
    this.sendTree = this.sendTree.bind(this);
    backburner.on('end', this.sendTree);
  },

  cleanupListeners() {
    this.lastRightClicked = null;
    window.removeEventListener('mousedown', this.onRightClick);

    window.removeEventListener('resize', this.onResize);

    backburner.off('end', this.sendTree);

    if (this.scheduledSendTree) {
      window.clearTimeout(this.scheduledSendTree);
    }
  },

  onRightClick(event) {
    if (event.button === 2) {
      this.lastRightClicked = event.target;
    }
  },

  onResize() {
    // TODO hide or redraw highlight/tooltip
  },

  inspectNearest(node) {
    let renderNode = this.viewInspection.inspectNearest(node);

    if (renderNode) {
      this.sendMessage('inspectComponent', { id: renderNode.id });
    } else {
      this.adapter.log('No Ember component found.');
    }
  },

  retainObject(object) {
    let guid = this.objectInspector.retainObject(object);
    this.retainedObjects.push(guid);
    return guid;
  },

  releaseCurrentObjects() {
    this.retainedObjects.forEach(guid => {
      this.objectInspector.releaseObject(guid);
    });
    this.retainedObjects = [];
  },

  willDestroy() {
    this._super();

    this.cleanupLayers();
    this.cleanupListeners();

    this.releaseCurrentObjects();
    this.stopInspecting();
  },

  /**
   * Opens the "Elements" tab and selects the given DOM node. Doesn't work in all
   * browsers/addons (only in the Chrome and FF devtools addons at the time of writing).
   *
   * @method inspectNode
   * @param  {Node} node The DOM node to inspect
   */
  inspectNode(node) {
    this.get('adapter').inspectNode(node);
  },

  sendTree() {
    if (this.scheduledSendTree) {
      return;
    }

    window.setTimeout(() => this.send(), 250);
  },

  send() {
    if (this.isDestroying) {
      return;
    }

    this.sendMessage('renderTree', {
      tree: this.getTree()
    });
  },

  getTree() {
    this.releaseCurrentObjects();
    return this.renderTree.build();
  },

  startInspecting() {
    this.sendMessage('startInspecting', {});
    this.viewInspection.start();
  },

  stopInspecting() {
    this.viewInspection.stop();
    this.sendMessage('stopInspecting', {});
  },

  didStopInspecting() {
    this.sendMessage('stopInspecting', {});
  },

  getOwner() {
    return this.namespace.owner;
  }
});
