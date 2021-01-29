Qth ZWave.js Gateway
====================

A [ZWave](http://www.z-wave.com/) gateway for
[Qth](https://github.com/mossblaser/qth) based on
[ZWave.js](https://github.com/zwave-js/node-zwave-js). This gateway contains
just enough functionality to support the devices I use.

Compared with the original Python-based
[`qth_zwave`](https://github.com/mossblaser/qth_zwave), this version does not
depend on the ever painful OpenZWave C++ library. You can tell I was desparate
moving to a Javascript/Node based alternative(!). Javascript nonsense aside,
ZWave.js is comparatively well documented and actually seems to be quite robust
and well designed.


Qth API
-------

* `sys/zwave/`
  * `state`: Property indicating the current state of the network and
    controller. When 'all nodes ready' the network is ready for use.
  * `heal_network`: Propoerty. Set to `true` to begin the network healing
    process. When healing is complete, will be set back to `false`. Set to
    `false` to stop healing. Progress can be monitored using the
    `heal_network/progress` property which gives the healing status for each
    node.
  * `inclusion_mode`: Property. Set to `true` to begin network inclusion. When
    a node has been included (or inclusion has failed), this property will
    revert to `false`. The result of the inclusion process can be observed in
    the `inclusion_mode/result` property.
  * `exclusion_mode`: Property. Set to `true` to begin network exclusion. When
    a node has been excluded (or exclusion has failed), this property will
    revert to `false`. The result of the inclusion process can be observed in
    the `exclusion_mode/result` property.
  * `nodes/<NODE ID>/`
    * `manufacturer_name`. Property.
    * `description`. Property.
    * `neighbors`. Property. An array of node IDs.
    * `refresh_values`. Event which, when sent, will cause all node values to
      be polled.
    * `remove_failed_node`. Event. When the string 'remove' is sent, this node
      will be forcibly removed from the network.
    * `values/<VALUE NAME>`. Property or event representing a node value.
    * `values/<VALUE NAME>/metadata`. Object describing that value.
