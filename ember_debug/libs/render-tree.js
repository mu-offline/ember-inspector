import captureRenderTree from './capture-render-tree';

export default class RenderTree {
  /**
   * Sets up the initial options.
   *
   * @method constructor
   * @param {Object} options
   *  - {owner}      owner           The Ember app's owner.
   *  - {Function}   retainObject    Called to retain an object for future inspection.
   */
  constructor({ owner, retainObject, inspectNode }) {
    this.owner = owner;
    this.retainObject = retainObject;
    this.inspectNode = inspectNode;
    this._reset();
  }

  /**
   * Capture the render tree and serialize it for sending.
   *
   * This returns an array of `SerializedRenderNode`:
   *
   * type SerializedItem = string | number | bigint | boolean | null | undefined | { id: string };
   *
   * interface SerializedRenderNode {
   *   id: string;
   *   type: 'outlet' | 'engine' | 'route-template' | 'component';
   *   name: string;
   *   args: {
   *     named: Dict<SerializedItem>;
   *     positional: SerializedItem[];
   *   };
   *   instance: SerializedItem;
   *   template: Option<string>;
   *   bounds: Option<'single' | 'range'>;
   *   children: SerializedRenderNode[];
   * }
   *
   * @method build
   * @return {Array<SerializedRenderNode>} The render nodes tree.
   */
  build() {
    this._reset();
    this.tree = captureRenderTree(this.owner);
    return this._serializeRenderNodes(this.tree);
  }

  /**
   * Find a render node by id.
   *
   * @param {string} id A render node id.
   * @return {Option<SerializedRenderNode>} A render node with the given id, if any.
   */
  find(id) {
    let node = this.nodes[id];

    if (node) {
      return this._serializeRenderNode(node);
    } else {
      return null;
    }
  }

  /**
   * Find the deepest enclosing render node for a given DOM node.
   *
   * @method findNearest
   * @param {Node} node A DOM node.
   * @param {string} hint The id of the last-matched render node (see comment below).
   * @return {Option<SerializedRenderNode>} The deepest enclosing render node, if any.
   */
  findNearest(node, hint) {
    let hintNode = null;

    // Use the hint if we are given one. When doing "live" inspecting, the mouse likely
    // hasn't moved far from its last location. Therefore, the matching render node is
    // likely to be the same render node, one of its children, or its parent. Knowing this,
    // we can heuristically start the search from the parent render node (which would also
    // match against this node and its children), then only fallback to matching the entire
    // tree when there is no match in this subtree.
    if (hint) {
      hintNode = this.nodes[hint];

      let parentElement;

      if (hintNode && hintNode.bounds) {
        parentElement = hintNode.bounds.parentElement;
      }

      // Find the first parent render node with a different enclosing DOM element.
      // Usually, this is just the first parent render node, but there are cases where
      // multiple render nodes share the same bounds (e.g. outlet -> route template).
      while (hintNode && parentElement) {
        let parentNode = this._getParent(hintNode.id);

        if (parentNode) {
          let currentParentElement = parentElement;

          hintNode = parentNode;
          parentElement = parentNode.bounds && parentNode.bounds.parentElement;

          if (parentElement === currentParentElement) {
            continue;
          }
        }

        break;
      }
    }

    let renderNode;

    if (hintNode) {
      renderNode = this._matchRenderNodes([hintNode, ...this.tree], node);
    } else {
      renderNode = this._matchRenderNodes(this.tree, node);
    }

    if (renderNode) {
      return this._serializeRenderNode(renderNode);
    } else {
      return null;
    }
  }

  /**
   * Get the bounding rect for a given render node id.
   *
   * @method getBoundingClientRect
   * @param {*} id A render node id.
   * @return {Option<DOMRect>} The bounding rect, if the render node is found and has valid `bounds`.
   */
  getBoundingClientRect(id) {
    let node = this.nodes[id];

    // Element.getBoundingClientRect seems to be less buggy when it comes
    // to taking hidden (clipped) content into account, so prefer that over
    // Range.getBoundingClientRect when possible.

    if (node && node.bounds) {
      let { firstNode, lastNode } = node.bounds;

      if (firstNode === lastNode && firstNode.getBoundingClientRect) {
        return firstNode.getBoundingClientRect();
      } else {
        return this.getRange(id).getBoundingClientRect();
      }
    }

    return null;
  }

  /**
   * Get the DOM range for a give render node id.
   *
   * @method getRange
   * @param {string} id A render node id.
   * @return {Option<Range>} The DOM range, if the render node is found and has valid `bounds`.
   */
  getRange(id) {
    let range = this.ranges[id];

    if (range === undefined) {
      let node = this.nodes[id];

      if (node && node.bounds) {
        let { parentElement, firstNode, lastNode } = node.bounds;

        if (firstNode.parentElement === parentElement && lastNode.parentElement === parentElement) {
          range = document.createRange();
          range.setStartBefore(node.bounds.firstNode);
          range.setEndAfter(node.bounds.lastNode);
        } else {
          // The node has already been detached, we probably have a stale tree
          range = null;
        }
      } else {
        range = null;
      }

      this.ranges[id] = range;
    }

    return range;
  }

  /**
   * Scroll the given render node id into view (if the render node is found and has valid `bounds`).
   *
   * @method scrollIntoView
   * @param {string} id A render node id.
   */
  scrollIntoView(id) {
    let node = this.nodes[id];

    if (!node || node.bounds === null) {
      return;
    }

    let element = this._findNode(node.bounds, [Node.ELEMENT_NODE]);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }
  }

  /**
   * Inspect the bounds for the given render node id in the "Elements" panel (if the render node
   * is found and has valid `bounds`).
   *
   * @method inspectElement
   * @param {string} id A render node id.
   */
  inspectElement(id) {
    let node = this.nodes[id];

    if (!node || node.bounds === null) {
      return;
    }

    // We cannot inspect text nodes
    let target = this._findNode(node.bounds, [Node.ELEMENT_NODE, Node.COMMENT_NODE]);

    this.inspectNode(target);
  }

  _reset() {
    this.tree = [];
    this.nodes = Object.create(null);
    this.parentNodes = Object.create(null);
    this.serialized = Object.create(null);
    this.ranges = Object.create(null);
  }

  _serializeRenderNodes(nodes, parentNode = null) {
    return nodes.map(node => this._serializeRenderNode(node, parentNode));
  }

  _serializeRenderNode(node, parentNode = null) {
    let serialized = this.serialized[node.id];

    if (serialized === undefined) {
      this.nodes[node.id] = node;

      if (parentNode) {
        this.parentNodes[node.id] = parentNode;
      }

      this.serialized[node.id] = serialized = {
        ...node,
        args: this._serializeArgs(node.args),
        instance: this._serializeItem(node.instance),
        bounds: this._serializeBounds(node.bounds),
        children: this._serializeRenderNodes(node.children, node),
      };
    }

    return serialized;
  }

  _serializeArgs({ named, positional }) {
    return {
      named: this._serializeDict(named),
      positional: this._serializeArray(positional),
    };
  }

  _serializeBounds(bounds) {
    if (bounds === null) {
      return null;
    } else if (bounds.firstNode === bounds.lastNode) {
      return 'single';
    } else {
      return 'range';
    }
  }

  _serializeDict(dict) {
    let result = Object.create(null);

    Object.keys(dict).forEach(key => {
      result[key] = this._serializeItem(dict[key]);
    });

    return result;
  }

  _serializeArray(array) {
    return array.map(item => this._serializeItem(item));
  }

  _serializeItem(item) {
    switch (typeof item) {
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'undefined':
        return item;

      default:
        return item && this._serializeObject(item);
    }
  }

  _serializeObject(object) {
    return { id: this.retainObject(object) };
  }

  _getParent(id) {
    return this.parentNodes[id] || null;
  }

  _matchRenderNodes(renderNodes, dom, deep = true) {
    let candidates = [...renderNodes];

    while (candidates.length > 0) {
      let candidate = candidates.shift();
      let range = this.getRange(candidate.id);

      if (range && range.isPointInRange(dom, 0)) {
        // We may be able to find a more exact match in one of the children.
        return this._matchRenderNodes(candidate.children, dom, false) || candidate;
      } else if (!range || deep) {
        // There are some edge cases of non-containing parent nodes (e.g. "worm
        // hole") so we can't rule out the entire subtree just because the parent
        // didn't match. Howevwe, we should come back to this subtree at the end
        // since we are unlikely to find a match here.
        candidates.push(...candidate.children);
      } else {
        // deep = false: In this case, we already found a matching parent,
        // we are just trying to find a more precise match here. If the child
        // does not contain the DOM node, we don't need to travese further.
      }
    }

    return null;
  }

  _findNode(bounds, nodeTypes) {
    let node = bounds.firstNode;

    do {
      if (nodeTypes.indexOf(node.nodeType) > -1) {
        return node;
      } else {
        node = node.nextSibling;
      }
    } while (node && node !== bounds.lastNode);

    return bounds.parentElement;
  }
}