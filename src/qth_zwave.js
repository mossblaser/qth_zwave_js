import { Driver } from "zwave-js";

import Client from "qth";

import { ArgumentParser } from "argparse";


class QthValueBridge {
  constructor(qth, qthPrefix, node, valueId) {
    this.onSetValue = this.onSetValue.bind(this);
    
    this.qth = qth;
    this.node = node;
    this.valueId = valueId;
    this.metadata = this.node.getValueMetadata(this.valueId);
    
    const normalisedName = this.metadata.label.replaceAll(/[^A-Za-z0-9()]+/g, '-');
    this.valuePath = `${qthPrefix}values/${normalisedName}`;
    
    
    // The value itself
    this.qth.register(
      this.valuePath,
      this.metadata.readable ? "PROPERTY-1:N" : "EVENT-N:1",
      (
        `Zwave '${this.metadata.label}' value. `
        + `Command class ${this.valueId.commandClass} (${this.valueId.commandClassName}), `
        + `endpoint ${this.valueId.endpoint}, `
        + `property ${this.valueId.property} (${this.valueId.propertyName}), `
        + `property key ${this.valueId.propertyKey} (${this.valueId.propertyKeyName}). `
        + `Metadata: ${JSON.stringify(this.metadata)}`
      ),
      this.metadata.readable ? {"delete_on_unregister": true} : {},
    );
    if (this.metadata.readable) {
      const curValue = this.node.getValue(this.valueId);
      this.expectedValues = [curValue];
      this.qth.setProperty(this.valuePath, curValue);
      
      this.node.setMaxListeners(0);
      this.node.on("value updated", (_node, {commandClass, endpoint, property, propertyKey, newValue}) => {
        if (
          commandClass === this.valueId.commandClass &&
          endpoint === this.valueId.endpoint &&
          property === this.valueId.property &&
          propertyKey === this.valueId.propertyKey
        ) {
          this.expectedValues.push(newValue);
          this.qth.setProperty(this.valuePath, newValue);
        }
      })
    }
    if (this.metadata.writeable) {
      if (this.metadata.readable) {
        this.qth.watchProperty(this.valuePath, this.onSetValue);
      } else {
        this.qth.watchEvent(this.valuePath, this.onSetValue);
      }
    }
    
    // Metadata
    this.qth.register(
      `${this.valuePath}/metadata`,
      "PROPERTY-1:N",
      "Information describing the value",
      {"delete_on_unregister": true},
    );
    this.qth.setProperty(`${this.valuePath}/metadata`, this.metadata);
  }
  
  onSetValue(_topic, value) {
    const i = this.expectedValues.indexOf(value)
    if (i < 0) {
      if (value !== undefined) {
        this.node.setValue(this.valueId, value);
      }
    } else {
      // Ignore expected value arriving
      this.expectedValues.splice(i, 1);
    }
  }
  
  remove() {
    this.qth.unregister(this.valuePath);
    if (this.metadata.writeable) {
      if (this.metadata.readable) {
        this.qth.unwatchProperty(this.valuePath, this.onSetValue);
      } else {
        this.qth.unwatchEvent(this.valuePath, this.onSetValue);
      }
    }
    
    this.qth.unregister(`${this.valuePath}/metadata`);
  }
}


class QthNodeBridge {
  constructor(qth, qthPrefix, controller, node) {
    this.qth = qth;
    this.controller = controller,
    this.node = node;
    this.nodePrefix = `${qthPrefix}nodes/${this.node.id}/`;
    
    this.values = [];
    
    this.node.on("ready", () => {
      this.qth.register(
        `${this.nodePrefix}manufacturer_name`,
        "PROPERTY-1:N",
        "Device manufacturer's name",
        {"delete_on_unregister": true},
      );
      this.qth.setProperty(
        `${this.nodePrefix}manufacturer_name`,
        node.deviceConfig.manufacturer,
      );
      
      this.qth.register(
        `${this.nodePrefix}description`,
        "PROPERTY-1:N",
        "Device description",
        {"delete_on_unregister": true},
      );
      this.qth.setProperty(
        `${this.nodePrefix}description`,
        node.deviceConfig.description,
      );
      
      this.qth.register(
        `${this.nodePrefix}neighbors`,
        "PROPERTY-1:N",
        "Neighbouring node IDs",
        {"delete_on_unregister": true},
      );
      this.qth.setProperty(
        `${this.nodePrefix}neighbors`,
        node.neighbors,
      );
      
      // Refresh
      this.qth.register(
        `${this.nodePrefix}refresh_values`,
        "EVENT-N:1",
        "Trigger a poll of all this node's values",
        {"delete_on_unregister": true},
      );
      this.onRefreshValues = this.onRefreshValues.bind(this);
      this.qth.watchEvent(`${this.nodePrefix}refresh_values`, this.onRefreshValues);
      
      // Remove failed node
      this.qth.register(
        `${this.nodePrefix}remove_failed_node`,
        "EVENT-N:1",
        "Send the string 'remove' to forcibly remove this node from the controller.",
        {"delete_on_unregister": true},
      );
      this.onRemoveFailedNode = this.onRemoveFailedNode.bind(this);
      this.qth.watchEvent(`${this.nodePrefix}remove_failed_node`, this.onRemoveFailedNode);
      
      // Values
      for (let valueId of this.node.getDefinedValueIDs()) {
        this.values.push(new QthValueBridge(this.qth, this.nodePrefix, this.node, valueId));
      }
    });
  }
  
  onRefreshValues() {
    this.node.refreshValues();
  }
  
  onRemoveFailedNode(_topic, value) {
    if (value === "remove") {
      this.controller.removeFailedNode(this.node.id);
    }
  }
  
  remove() {
    this.qth.unregister(`${this.nodePrefix}manufacturer_name`);
    this.qth.unregister(`${this.nodePrefix}description`);
    this.qth.unregister(`${this.nodePrefix}neighbors`);
    this.qth.unregister(`${this.nodePrefix}refresh_values`);
    this.qth.unregister(`${this.nodePrefix}remove_failed_node`);
    
    this.qth.unwatchEvent(`${this.nodePrefix}refresh_values`, this.onRefreshValues);
    this.qth.unwatchEvent(`${this.nodePrefix}remove_failed_node`, this.onRemoveFailedNode);
    
    for (let value of this.values) {
      value.remove();
    }
  }
}


class QthZwaveBridge {
  constructor(qthHostWs, qthPrefix, zwaveDriver) {
    this.qth = new Client(qthHostWs, {
      "clientId": "qth_zwave_js",
      "description": "A Qth/ZWave bridge",
    });
    this.qthPrefix = qthPrefix;
    
    this.driver = zwaveDriver;
    
    this.nodes = new Map();
    
    // Status monitoring
    this.qth.register(
      `${this.qthPrefix}state`,
      "PROPERTY-1:N",
      "Human-readable state of the ZWave network interface.",
      {"delete_on_unregister": true},
    );
    const setState = (state) => {
      this.qth.setProperty(`${this.qthPrefix}state`, state)
    }
    setState("starting");
    this.driver.on("error", (e) => setState(`error: ${e}`));
    this.driver.on("driver ready", () => setState("driver ready"));
    this.driver.on("all nodes ready", () => setState("all nodes ready"));
    
    // Healing
    this.driver.on("driver ready", () => {
      this.qth.register(
        `${this.qthPrefix}heal_network`,
        "EVENT-N:1",
        "Send a non-false value to start healing, send false top stop it.",
      );
      this.qth.register(
        `${this.qthPrefix}heal_network/progress`,
        "PROPERTY-1:N",
        "An object giving the healing status of each node (or null if not healing)",
        {"delete_on_unregister": true},
      );
      const setHealProgress = (progress) => {
        this.qth.setProperty(`${this.qthPrefix}heal_network/progress`, progress)
      }
      setHealProgress(null);
      this.qth.watchEvent(`${this.qthPrefix}heal_network`, (_topic, command) => {
        if (command !== false) {
          this.driver.controller.beginHealingNetwork();
          setHealProgress({});
        } else {
          this.driver.controller.stopHealingNetwork();
          setHealProgress(null);
        }
      })
      this.driver.controller.on("heal network progress", (progress) => {
        setHealProgress(Object.fromEntries(progress));
      });
      this.driver.controller.on("heal network done", () => {
        setHealProgress(null);
      });
    });
    
    // Inclusion/Exclusion
    this.driver.on("driver ready", () => {
      for (let kind of ["inclusion", "exclusion"]) {
        this.qth.register(
          `${this.qthPrefix}${kind}_mode`,
          "PROPERTY-N:1",
          "Set to true to begin ${kind} and false to stop ${kind}.",
          {"delete_on_unregister": true},
        );
        this.qth.register(
          `${this.qthPrefix}${kind}_mode/result`,
          "PROPERTY-1:N",
          "Stores the state of the last ${kind} operation.",
          {"delete_on_unregister": true},
        );
        this.qth.setProperty(`${this.qthPrefix}${kind}_mode`, false);
        this.qth.watchProperty(`${this.qthPrefix}${kind}_mode`, (_topic, state) => {
          const tkind = kind.replace(kind[0], kind[0].toUpperCase());
          if (state === true) {
            this.driver.controller[`begin${tkind}`]()
          } else {
            this.driver.controller[`stop${tkind}`]()
          }
        })
        this.driver.controller.on(`${kind} started`, () => {
          this.qth.setProperty(`${this.qthPrefix}${kind}_mode/result`, "in progress");
        });
        this.driver.controller.on(`${kind} failed`, () => {
          this.qth.setProperty(`${this.qthPrefix}${kind}_mode/result`, "failed");
        });
        this.driver.controller.on(`${kind} stopped`, () => {
          this.qth.setProperty(`${this.qthPrefix}${kind}_mode/result`, "success or manually stopped");
        });
      }
    });
    
    
    // Nodes
    this.driver.on("driver ready", () => {
      for (let [id, node] of this.driver.controller.nodes.entries()) {
        this.nodes.set(id, new QthNodeBridge(this.qth, this.qthPrefix, this.driver.controller, node));
      }
      this.driver.controller.on("node added", (node) => {
        if (this.nodes.has(node.id)) {
          this.nodes.get(node.id).remove();
        }
        this.nodes.set(node.id, new QthNodeBridge(this.qth, this.qthPrefix, this.driver.controller, node));
      })
      this.driver.controller.on("node removed", (node) => {
        if (this.nodes.has(node.id)) {
          this.nodes.get(node.id).remove();
          this.nodes.delete(node.id);
        }
      })
    });
  }
}


async function main() {
  const parser = new ArgumentParser();
  parser.add_argument("--qth-host-uri", "-H", {
    help: "Qth server URI, e.g. tcp://hostname:port or wss://example.com/qth/ws",
    type: String,
    default: "tcp://localhost:1883",
  });
  parser.add_argument("--qth-prefix", "-p", {
    help: "Qth path prefix for zwave properties.",
    type: String,
    default: "sys/zwave/",
  });
  parser.add_argument("--serial-port", "-s", {
    help: "Serial port for zwave controller.",
    type: String,
    default: "/dev/ttyACM0",
  });
  parser.add_argument("--cache-dir", "-c", {
    help: "ZWave.js cache directory",
    default: "./qth_zwave_js_cache/",
  });
  parser.add_argument("--verbose", "-v", {
    help: "Increase logging verbosity. May be used multiple times.",
    action: "count",
    default: 0,
  });
  const args = parser.parse_args();
  
  const driver = new Driver(args.serial_port, {
    logConfig: { level: args.verbose },
    storage: { cacheDir: args.cache_dir },
  });
  const qth = new QthZwaveBridge(args.qth_host_uri, args.qth_prefix, driver);
  
  driver.start();
}

main();
