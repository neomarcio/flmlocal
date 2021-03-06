/*
The MIT License (MIT)

Copyright (c) 2016 Markus Gebhard <markus.gebhard@web.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
"use strict";

var ChartCtrl = function($scope) {
    $scope.debug = false;
    $scope.alerts = [];
    $scope.closeAlert = function(index) {
        $scope.alerts.splice(index, 1);
    };
    $scope.selCollapsed = false;
    // link to the web server's IP address for MQTT socket connection
    var client;
    var reconnectTimeout = 2e3;
    // the FLM03 port configuration
    var flx;
    // the Kube configuration
    var kube;
    // the FLM's web socket port from mosquitto
    var broker = location.hostname;
    var port = 8083;
    // chart data to display and selected details
    var chart = new Array(), selChart = new Array();
    // chart colors
    var color = 0;
    // detected sensor configurations
    var sensors = {};
    // chart display options
    var chartOptions = {
        series: {
            lines: {
                show: true,
                steps: true
            },
            points: {
                show: false
            }
        },
        grid: {
            hoverable: true
        },
        xaxis: {
            mode: "time",
            timezone: "browser"
        },
        yaxis: {
            min: 0
        },
        selection: {
            mode: "x"
        }
    };
    // the web socket connect function
    function mqttConnect() {
        var wsID = "FLM" + parseInt(Math.random() * 100, 10);
        client = new Paho.MQTT.Client(broker, port, "", wsID);
        var options = {
            timeout: 3,
            onSuccess: onConnect,
            onFailure: function(message) {
                setTimeout(mqttConnect, reconnectTimeout);
            }
        };
        // define callback routines
        client.onConnectionLost = onConnectionLost;
        client.onMessageArrived = onMessageArrived;
        client.connect(options);
    }
    // event handler on connection established
    function onConnect() {
        client.subscribe("/device/+/config/flx");
        client.subscribe("/device/+/config/kube");
        client.subscribe("/device/+/config/sensor");
        client.subscribe("/sensor/+/query/+/+");
    }
    // event handler on connection lost
    function onConnectionLost(responseObj) {
        setTimeout(mqttConnect, reconnectTimeout);
        if (responseObj.errorCode !== 0) console.log("onConnectionLost:" + responseObj.errorMessage);
    }
    // handle the received message
    function onMessageArrived(mqttMsg) {
        // split the received message at the slashes
        var topic = mqttMsg.destinationName.split("/");
        var payload;
        // the sensor message type is the third value of the topic
        switch (topic[1]) {
          case "device":
            payload = mqttMsg.payloadString;
            handle_device(topic, payload);
            break;

          case "sensor":
            if (topic[3] == "query") payload = mqttMsg.payloadBytes; else payload = mqttMsg.payloadString;
            handle_sensor(topic, payload);
            break;

          default:
            break;
        }
    }
    // handler for device configuration - needed to send actual query requests
    function handle_device(topic, payload) {
        var config = JSON.parse(payload);
        switch (topic[4]) {
          case "flx":
            flx = config;
            break;

          case "kube":
            kube = config;
            break;

          case "sensor":
            for (var obj in config) {
                var cfg = config[obj];
                if (cfg.enable == "1") {
                    if (sensors[cfg.id] === undefined) sensors[cfg.id] = new Object();
                    sensors[cfg.id].id = cfg.id;
                    if (cfg.port !== undefined) sensors[cfg.id].port = cfg.port[0];
                    if (cfg.type !== undefined) sensors[cfg.id].type = cfg.type;
                    if (cfg.subtype !== undefined) sensors[cfg.id].subtype = cfg.subtype;
                    if (flx !== undefined && flx[cfg.port] !== undefined) {
                        if (cfg.subtype !== undefined) {
                            sensors[cfg.id].name = flx[cfg.port[0]].name + " " + cfg.subtype;
                        } else {
                            sensors[cfg.id].name = flx[cfg.port[0]].name;
                        }
                    }
                    if (kube !== undefined && cfg.kid !== undefined) {
                        sensors[cfg.id].name = kube[cfg.kid].name + " " + cfg.type;
                        sensors[cfg.id].kid = cfg.kid;
                    }
                    sensors[cfg.id].data = new Array();
                    // add graph selection option
                    if (!$("#" + cfg.id).length) $("#choices").append("<div class='checkbox'>" + "<small><label>" + "<input type='checkbox' id='" + sensors[cfg.id].id + "'></input>" + sensors[cfg.id].name + "</label></small>" + "</div>");
                }
            }
            break;
        }
    }
    // compute the received data series
    function handle_sensor(topic, payload) {
        if (topic[3] != "query") return;
        var gunzip = new Zlib.Gunzip(payload);
        var decom = gunzip.decompress();
        var str = "";
        var i, qfrom, qto, qtime, qval;
        for (i = 0; i < decom.length; i++) {
            str += String.fromCharCode(decom[i]);
        }
        var tmpo = JSON.parse(str);
        if (sensors[tmpo.h.cfg.id] === undefined) {
            sensors[tmpo.h.cfg.id] = new Object();
            sensors[tmpo.h.cfg.id].id = tmpo.h.cfg.id;
            if (flx !== undefined) {
                sensors[tmpo.h.cfg.id].name = flx[tmpo.h.cfg.port[0]].name + " " + tmpo.h.cfg.subtype;
            } else {
                sensors[tmpo.h.cfg.id].name = tmpo.h.cfg.id;
            }
            sensors[tmpo.h.cfg.id].type = tmpo.h.cfg.type;
            sensors[tmpo.h.cfg.id].subtype = tmpo.h.cfg.subtype;
            sensors[tmpo.h.cfg.id].data = new Array();
        }
        qfrom = topic[4];
        qto = topic[5];
        qtime = tmpo.h.head[0];
        qval = tmpo.h.head[1];
        // retrieve the sensor time series in the selected query interval
        for (i = 0; i < tmpo.v.length; i++) {
            qtime += tmpo.t[i];
            qval += tmpo.v[i];
            if (qfrom <= qtime && qtime <= qto) {
                sensors[tmpo.h.cfg.id].data.push([ qtime, qval ]);
            }
        }
        // sort values from 'to' to 'from'
        sensors[tmpo.h.cfg.id].data.sort(function(a, b) {
            var x = a[0];
            var y = b[0];
            return x - y;
        });
        chart_sensor(tmpo.h.cfg.id);
    }
    // draw the sensor's chart
    function chart_sensor(sensor) {
        var data = new Array();
        var qtime, qval, deltax, deltat;
        var sumt, sumx;
        var lastt;
        var i, sec;
        data = [];
        deltax = 0;
        deltat = 0;
        sumx = 0;
        sumt = 0;
        // set length of "rolling average"
        switch (sensors[sensor].subtype) {
          case "pplus":
          case "pminus":
          case "q1":
          case "q2":
          case "q3":
          case "q4":
          case "vrms":
          case "irms":
            sec = 30;
            break;

          default:
            sec = 1;
            break;
        }
        // set timestamp on ms
        if (sensors[sensor].data.length > 0) lastt = sensors[sensor].data[0][0] * 1e3;
        // now compute the "rolling average"
        for (i = 1; i < sensors[sensor].data.length; i++) {
            qtime = sensors[sensor].data[i][0] * 1e3;
            qval = sensors[sensor].data[i][1];
            deltax = sensors[sensor].data[i][1] - sensors[sensor].data[i - 1][1];
            deltat = sensors[sensor].data[i][0] - sensors[sensor].data[i - 1][0];
            sumx += deltax;
            sumt += deltat;
            if (sumt >= sec || i == sensors[sensor].data.length - 1) {
                // compute the different sensor types
                switch (sensors[sensor].type) {
                  case "electricity":
                    // calculate the wattage from the given Wh values in time interval
                    switch (sensors[sensor].subtype) {
                      case "pplus":
                      case "pminus":
                      case "q1":
                      case "q2":
                      case "q3":
                      case "q4":
                        qval = 3600 * sumx / sumt;
                        break;

                      default:
                        // just take qval as it is
                        break;
                    }
                    break;

                  case "water":
                  case "gas":
                    // sum up the volume flown during a time interval; no division here
                    qval = sumx;
                    break;

                  default:
                    qval = sumx;
                    break;
                }
                // round on two digits
                qval = Math.round(qval * 100) / 100;
                sumx = 0;
                sumt = 0;
                if (deltat >= sec) data.push([ lastt, qval ]);
                data.push([ qtime, qval ]);
            }
            lastt = qtime;
        }
        // check if chart has to be altered or a new series has to be added
        var obj = chart.filter(function(o) {
            return o.label == sensors[sensor].name;
        });
        if (obj[0] == null) {
            obj = {};
            obj.label = sensors[sensor].name;
            obj.data = data;
            obj.color = color;
            color++;
            chart.push(obj);
        } else {
            obj[0].data = data;
        }
        // process the chart selection
        $("#choices").find("input").on("click", plotSelChart);
        function plotSelChart() {
            selChart = [];
            $("#choices").find("input:checked").each(function() {
                var key = sensors[$(this).attr("id")].name;
                var s = chart.filter(function(o) {
                    return o.label == key;
                });
                if (s[0] !== undefined) selChart.push(s[0]);
            });
            $("#info").html("");
            // size the output area and plot the chart
            if (selChart.length > 0) {
                var width = $("#chartpanel").width();
                var height = width * 3 / 4;
                height = height > 600 ? 600 : height;
                $("#chart").width(width).height(height);
                $("#chart").plot(selChart, chartOptions);
            } else {
                $("#chart").html("").height(0);
            }
        }
        // and finally plot the graph
        $("#info").html("");
        plotSelChart();
        // process hover
        $("#chart").on("plothover", function(event, pos, item) {
            if (item) {
                var itemTime = new Date(item.datapoint[0]);
                var hrs = itemTime.getHours();
                hrs = hrs < 10 ? "0" + hrs : hrs;
                var min = itemTime.getMinutes();
                min = min < 10 ? "0" + min : min;
                var sec = itemTime.getSeconds();
                sec = sec < 10 ? "0" + sec : sec;
                $("#tooltip").html(hrs + ":" + min + ":" + sec + " : " + item.datapoint[1]).css({
                    top: item.pageY + 7,
                    left: item.pageX + 5
                }).fadeIn(200);
            } else $("#tooltip").hide();
        });
        // process selection time interval
        $("#chart").on("plotselected", function(event, range) {
            var selFrom = range.xaxis.from.toFixed(0);
            var selTo = range.xaxis.to.toFixed(0);
            var details = new Array();
            // filter values within the selected time interval
            for (var i in selChart) {
                var selObj = {};
                selObj.color = selChart[i].color;
                selObj.label = selChart[i].label;
                selObj.data = selChart[i].data.filter(function(v) {
                    return v[0] >= selFrom && v[0] <= selTo;
                });
                details.push(selObj);
            }
            // size the output area
            var width = $("#chartpanel").width();
            var height = width * 3 / 4;
            height = height > 600 ? 600 : height;
            $("#chart").width(width).height(height);
            $("#chart").plot(details, chartOptions);
            $("#info").html('<div align="center"><button class="btn btn-primary btn-sm" id="reset">Reset</button></div>');
            // redraw the queried data
            $("#reset").on("click", function() {
                $("#chart").plot(selChart, chartOptions);
            });
        });
    }
    // set the time interval to the current time
    $("#refresh").on("click", function() {
        var dNow = new Date();
        var day = dNow.getDate();
        day = day < 10 ? "0" + day : day;
        var month = dNow.getMonth() + 1;
        month = month < 10 ? "0" + month : month;
        var hrs = dNow.getHours();
        hrs = hrs < 10 ? "0" + hrs : hrs;
        var min = dNow.getMinutes();
        min = min < 10 ? "0" + min : min;
        var sec = dNow.getSeconds();
        sec = sec < 10 ? "0" + sec : sec;
        var localDate = dNow.getFullYear() + "-" + month + "-" + day;
        var localTime = hrs + ":" + min + ":" + sec;
        $("#fromDate").val(localDate);
        $("#fromTime").val(localTime);
        $("#toDate").val(localDate);
        $("#toTime").val(localTime);
        // enable all sensor selections
        for (var s in sensors) {
            sensors[s].data = [];
            $("#" + sensors[s].id).prop("disabled", false);
            $("#" + sensors[s].id).prop("checked", false);
        }
        // clear the chart and chart area
        $("#chart").html("").height(0);
        chart = [];
        $("#info").html("");
    });
    // prepare and emit the query request
    $("#submit").on("click", function() {
        var fromDate = $("#fromDate").val();
        var fromTime = $("#fromTime").val();
        var toDate = $("#toDate").val();
        var toTime = $("#toTime").val();
        var offset = new Date().getTimezoneOffset() * 60;
        var from = Date.parse(fromDate + "T" + fromTime + "Z") / 1e3 + offset;
        var to = Date.parse(toDate + "T" + toTime + "Z") / 1e3 + offset;
        if (isNaN(from) || isNaN(to)) {
            $("#info").html("<div align='center'>Date or Time invalid...</div>");
            return;
        }
        var msg = new Paho.MQTT.Message("[" + from + "," + to + "]");
        for (var s in sensors) {
            // clear potentially existing chart data
            sensors[s].data = [];
            $("#" + sensors[s].id).prop("disabled", true);
        }
        // now send the query request by mqtt
        var queried = 0;
        $("#choices").find("input:checked").each(function() {
            msg.destinationName = "/query/" + $(this).attr("id") + "/tmpo";
            client.send(msg);
            $("#" + $(this).attr("id")).prop("disabled", false);
            queried++;
        });
        // clear the chart section and show notification
        chart = [];
        color = 0;
        $("#chart").html("");
        if (queried > 0) {
            $("#info").html("<div align='center'>Query request sent...</div>");
        } else {
            $("#info").html("<div align='center'>Nothing selected...</div>");
            setTimeout(function() {
                $("#refresh").click();
            }, 2e3);
        }
    });
    // allow tooltip on datapoints
    $("<div id='tooltip'></div>").css({
        position: "absolute",
        display: "none",
        border: "1px solid #ccc",
        padding: "2px",
        opacity: .9
    }).appendTo("body");
    mqttConnect();
};

// the part of the AngularJS application that handles the charts
ChartCtrl.$inject = [ "$scope" ];

angular.module("flmUiApp").controller("ChartCtrl", ChartCtrl);