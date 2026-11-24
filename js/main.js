/// Global event handlers
var callbacks = {};
/// Execute callback
function execCallback(id) {
	if (!callbacks[id]) {
		return null;
	}
	callbacks[id].call();
	delete callbacks[id];
}
(function( $ , _ ) {
	/// Wialon messages loader
	var mloader = null;
	/// Current wialon unit
	var cunit = null;
	/// Current times [time_from, time_to]
	var ctimes = null;
	/// Time format
	var enFormatTime = '';
	/// Locations cache
	var locationsData = {};
	/// Timer for detecting locations request
	var timerId = 0;
	/// Flag to indicate whether detecting of locations is in progress
	var inProgress = false;
	/// Timer for handling resize event
	var resizeTimer = 0;
	/// Current messages type
	var curType = 0x000;
	/// Last message of current unit
	var lastMessage = null;
	/// Last position of current unit
	var lastPosition = null;
	/// Current page
	var currentPage = 1;
	/// Current number of rows on the page
	var currentRowOnPage = 10;
	/// Total count of messages
	var msgsCount = 0;
	/// Messages
	var msgs = [];
	var processedmsgs = [];
	var msgsLimit = 100000; // limit messages
	var TZ = 0,
		DST = 0,
		TODAY = {
			from: 0,
			to: 0
		};
	var LOCAL_STATE = {
		time_from: 0,
		time_to: 0,
		time_custom: null,
		time_type: 0
	};
	var changeTimeTimeout;
	var filter = {},filters={},filter_state=1;
	var lang = 'en';

	/// IE check
	function ie() {
		return (navigator.appVersion.indexOf("MSIE 6") !== -1 ||
				navigator.appVersion.indexOf("MSIE 7") !== -1 ||
				navigator.appVersion.indexOf("MSIE 8") !== -1);
	}
	/// Wrap callback
	function wrapCallback(callback) {
		var id = (new Date()).getTime();
		callbacks[id] = callback;
		return id;
	}
	/// Fetch variable from 'GET' request
	var getHtmlParameter = _.memoize(function (name,def) {
		if (!name) {
			return null;
		}
		var pairs = document.location.search.substr(1).split("&");
		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split("=");
			if (decodeURIComponent(pair[0]) === name) {
				return decodeURIComponent(pair[1]);
			}
		}
		return def || null;
	});
	/// Load scripts
	function loadScript(src, callback) {
		var script = document.createElement("script");
		script.setAttribute("type","text/javascript");
		script.setAttribute("charset","UTF-8");
		script.setAttribute("src", src);
		if (callback && typeof callback === "function") {
			var id = wrapCallback(callback);
			if (ie()) {
				script.onreadystatechange = function () {
					if (this.readyState === 'complete' || this.readyState == 'loaded') {
						callback();
					}
				};
			} else {
				script.setAttribute("onLoad", "execCallback(" + wrapCallback(callback) + ")");
			}
		}
		document.getElementsByTagName("head")[0].appendChild(script);
	}
	/// Fill in the interface 'select' html for control unit selection
	function fillUnitsSelect(items) {
		var html = "";
		for (var i=0, len=items.length; i<len; i++) {
			var item = items[i];
			if (!item) {
				continue;
			}
			var access = item.getUserAccess();
			if (wialon.util.Number.and(wialon.item.Item.accessFlag.execReports, access)) {
				html += "<option value='" + item.getId() + "'>" + item.getName() + "</option>";
			}
		}
		$("#units-select").html(html).change();
	}
	/// Login result
	function login(code) {
		if (code) {
			alert($.localise.tr("Invalid user name or password"));
			return;
		}

		disableui();

		var specUnit = {itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name"};
		var flagsUnit = wialon.item.Item.dataFlag.base | wialon.item.Unit.dataFlag.lastMessage;
		wialon.core.Session.getInstance().searchItems(specUnit, true, flagsUnit, 0, 0, function (code, data) {

			// get string of time format
			wialon.core.Session.getInstance().getCurrUser().getLocale(function(arg, locale){

				var fd = (locale && locale.fd) ? locale.fd : '%Y-%m-%E_%H:%M:%S'; // check for users who have never changed the parameters of the metric

				enFormatTime = wialon.util.DateTime.convertFormat(fd,true).replace(/_/, '&nbsp;&nbsp;').replace(/ /, '&nbsp;');
				setLocaleDateTime();

				if (code || !data || !data.items || !data.items.length)
					return;
				fillUnitsSelect(data.items);

				initDatepicker(
					(locale && locale.wd && locale.wd > 1) ? 0 : 1,
					fd
				);
				undisableui();
			});
		});

	}
	/// Init SDK
	function initSdk() {
		var url = getHtmlParameter("baseUrl","https://hst-api.wialon.com");
		if (!url) {
			url = getHtmlParameter("hostUrl","https://hosting.wialon.com");
		}
		if (!url) {
			return null;
		}

		var user = getHtmlParameter("user") || "";

		wialon.core.Session.getInstance().initSession(url,"gapp_messagesmanager",0x800);

		var sid = getHtmlParameter("sid");
		var authHash = getHtmlParameter("authHash");

		if (authHash) {
			wialon.core.Session.getInstance().loginAuthHash(authHash, login);
		} else if (sid) {
			wialon.core.Session.getInstance().duplicate(sid, user, true, login);
		}

		mloader = wialon.core.Session.getInstance().getMessagesLoader();
	}

	/// clear filters
	function clearFilter (event) {
		jQuery("#filter").removeClass('active');
		filters[curType]=filter;
		curType = parseInt($("#msg_type").val());
		if (curType ==  0x000){
			filter = filters[curType]||{};
			jQuery("#by_speed").show();
			jQuery("#by_sat").show();
		} else if(curType ==  0x600) {
			filter = filters[curType]||{};
			jQuery("#by_speed").hide();
			jQuery("#by_sat").hide();
		} else {
			filter = {};
			jQuery("#filter").addClass('disabled');
			filter_state=0;
			return;
		}
		if(filter.param || filter.speed_from || filter.speed_to || filter.sat_from || filter.sat_to){
			jQuery("#filter").addClass('active');
		} else {
			jQuery("#filter").removeClass('active');
		}
		jQuery("#filter").removeClass('disabled');
		filter_state=1;
	}
	/// Show button click handler
	function execute (event) {
		if (!cunit)
			return;
		lastMessage = cunit.getLastMessage();
		lastPosition = cunit.getPosition();
		currentPage = 1;

		disableui();
		var times = $("#ranging-time-wrap").intervalWialon('get');
		if (!times)
			return;

		ctimes = times; // stores current worker time in global variable

		$("#paginated-table").width("100%");
		loadMsgs();
	}

	/// Load messages
	function loadMsgs() {
		msgs = [];
		currentRowOnPage = parseInt($("#nrowonpage").val());
		mloader.loadInterval(cunit.getId(), ctimes[0], ctimes[1],  curType, 0xff00, 0, qx.lang.Function.bind(function (code, messages) {
			if (code === 0 && messages.count) {
				var template;
				var data={};

				var display = "none";
				if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
					display = "inline-block";
				}
				var mu = getMeasureUnits(cunit);
				if (curType ==  0x000) {
					data = {
						display: display,
						tm: $.localise.tr("Time"),
						lon: $.localise.tr("Longitude"),
						lat: $.localise.tr("Latitude"),
						alt: (mu == 1 || mu == 2) ? $.localise.tr("Altitude, ft") : $.localise.tr("Altitude, m"),
						loc: $.localise.tr("Location"),
						speed: (mu == 1 || mu == 2) ? $.localise.tr("Speed, mph") : $.localise.tr("Speed, km/h"),
						course: $.localise.tr("Course"),
						scount: $.localise.tr("Satellites"),
						io: $.localise.tr("I/O"),
						params: $.localise.tr("Parameters")
					};
					template = _.template($("#data_header").html());
				} else if(curType ==  0x100) {
					data = {
						display: display,
						tm: $.localise.tr("Time"),
						text: $.localise.tr("Text"),
						phone: $.localise.tr("Phone")
					};
					template = _.template($("#sms_header").html());
				} else if(curType ==  0x200) {
					data = {
						display: display,
						tm: $.localise.tr("Time"),
						cname: $.localise.tr("Commnand name"),
						ctype: $.localise.tr("Commnand type"),
						cparams: $.localise.tr("Command parameters"),
						user: $.localise.tr("User"),
						channel: $.localise.tr("Channel"),
						extime: $.localise.tr("Execution time")
					};
					template = _.template($("#command_header").html());
				} else if(curType ==  0x600) {
					data = {
						display: display,
						tm: $.localise.tr("Time"),
						type: $.localise.tr("Type"),
						text: $.localise.tr("Event text"),
						lon: $.localise.tr("Longitude"),
						lat: $.localise.tr("Latitude"),
						params: $.localise.tr("Parameters")
					};
					template = _.template($("#event_header").html());
				}
				$("#del_btn").css("display",display);
				$("#header-wrap").css("display","block");
				$("#header-wrap thead").html(template(data));
				$("#check_all").click(function() {
					$("#paginated-table input:enabled").attr("checked",this.checked);
					$("#del_btn").attr("disabled",!this.checked);
				});

				msgsCount = messages.count>msgsLimit?msgsLimit:messages.count;
				msgs=[];

				if (!$.isNumeric(currentPage)  || currentPage < 1 || currentPage > parseInt($("#cpages").html()) )
					currentPage = 1;

				getMsgsAll(qx.lang.Function.bind(function () {
					processMsgs();
					if(messages.count>msgsLimit){
						alert(sprintf($.localise.tr('%s messages found. First hundred thousand loaded.'), messages.count));
					}
				}));
			} else {
				$("#header-wrap").css("display","none");
				disabletableui ();
				$('#loading').removeClass('show');
				alert($.localise.tr("No data for selected interval."));
			}
		}, this));
	}

	/// Get messages
	function getMsgs(prevPage, curPage, prevRowOnPage, rowOnPage, callback) {
		if (prevPage>=1) {
			var from = (prevPage-1)*prevRowOnPage;
			var to =  from + prevRowOnPage;
			for (var i=from;i<to; i++)
				delete msgs[i];
		}
		var from = (curPage-1)*rowOnPage;
		var to = from + rowOnPage;
		mloader.getMessages(from, to, qx.lang.Function.bind(function (code, messages) {
			if (code)
				return;
			for (var i=from,j=0;i<to;i++,j++)
				if (messages[j])
					msgs[i] = messages[j];
			if (callback && typeof callback == "function")
				callback();
		}));
	}

	function getMsgsAll(callback) {

		mloader.getMessages(0, msgsCount, qx.lang.Function.bind(function (code, messages) {
			if (code)
				return;
			msgs = messages;
			if (callback && typeof callback == "function")
				callback();
		}));
	}

	/// Rebind handlers for next and previous buttons
	function rebindHandlers() {
		var events = {};
		rebindHandler("next",jQuery._data($("#next")[0], "events"));
		rebindHandler("prev",jQuery._data($("#prev")[0], "events"));
		rebindHandler("last",jQuery._data($("#last")[0], "events"));
		rebindHandler("top",jQuery._data($("#top")[0], "events"));
	}

	/// Rebind handler for next and previous buttons
	function rebindHandler(targetId, events) {
		if (events && events.click && events.click[0]) {
			var click = events.click.pop();
			var eventHandler = click.handler;
			$("#"+targetId).click(function() {
				var pagesCount = parseInt($("#cpages").html());
				var targetPage;
				if (targetId == "next")
					targetPage = currentPage+1;
				else if (targetId == "prev")
					targetPage = currentPage-1;
				else if (targetId == "last")
					targetPage = pagesCount;
				else if (targetId == "top")
					targetPage = 1;
				if (targetPage > pagesCount || targetPage < 1)
					return;
				disableui();
				currentPage = targetPage;
				eventHandler();
				undisableui();
			});
		}
	}

	/// Create html table for msg data
	function msgsToTable (sindex, messages) {
		$("#del_btn").attr("disabled",true);
		$("#check_all").attr("checked",false);

		wialon.core.Remote.getInstance().startBatch();
		for (var i=0, len=messages.length; i<len; i++) {
			var msg = messages[i];
			if (!msg) {
				continue;
			}
			sindex = msgToTable(sindex, msg);
		}
		wialon.core.Remote.getInstance().finishBatch();

		$("#paginated-table tr:eq(0) td").resize(function() {
			clearTimeout(resizeTimer);
			resizeTimer = 0;
			var index = $(this).index();
			var width = $(this).outerWidth();
			$("#header-wrap th:eq("+index+")").css("min-width",width);

			$("#header-wrap").width($("#table-wrap")[0].clientWidth);
		});

		$("#paginated-table input").click(function() {
			var checkedCount = $("#paginated-table input:checked").length;
			if (!checkedCount) {
				$("#check_all").attr("checked",false);
				$("#del_btn").attr("disabled",true);
				return;
			}
			if (checkedCount == $("#paginated-table input:enabled").length)
				$("#check_all").attr("checked",true);
			else
				$("#check_all").attr("checked",false);
			$("#del_btn").attr("disabled",false);
		});


		setTimeout(function(){$("#paginated-table tr:eq(0) td").trigger("resize");},100);
	}

	function onDelete (event) {
		if (!cunit) {
			return null;
		}

		if (confirm($.localise.tr("Are you sure you want to delete selected messages?"))) {
			disableui();
			wialon.core.Remote.getInstance().startBatch("apply_message");

			jQuery("#paginated-table input:checked").each(function() {
				var index = parseInt(this.id.substr(10));
				mloader.deleteMessage(index);
			});
			wialon.core.Remote.getInstance().finishBatch(function (code, combinedCode) {
				loadMsgs();
			}, "apply_message");
		}
	}

	/// The auxiliary function for transform msg in table
	function msgToTable (sindex, msg) {
		var row = msgToRow(sindex++, msg);
		$("#paginated-table").children("tbody").append(row);
		return sindex;
	}

	function processMsgs() {
		disableui();
		processedmsgs = [];
		for( var i=0; i<msgs.length; i++) {
			if(curType == 0x000) {
				processedmsgs[i] = msgToData(parseInt(i), msgs[i]);
			} else if (curType == 0x100) {
				processedmsgs[i] = msgToSms(parseInt(i), msgs[i]);
			} else if (curType == 0x200) {
				processedmsgs[i] = msgToCommand(parseInt(i), msgs[i]);
			} else if (curType == 0x600) {
				processedmsgs[i] = msgToEvent(parseInt(i), msgs[i]);
			}
		}
		var paramreg = (filter.param || '').replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|]/g, "\\$&");
		paramreg = paramreg.replace(/\*/g,".*");
		paramreg = paramreg.replace(/\?/g,".");
		if(paramreg) {
			paramreg = new RegExp('.*' + paramreg + '.*','i');
		}
		if(filter.param || filter.speed_from || filter.speed_to || filter.sat_from || filter.sat_to){
			processedmsgs = processedmsgs.filter(function (el) {
				if(paramreg  && typeof el.params != 'undefined' && !(paramreg.test(el.params))){
					return false;
				}
				if(filter.sat_from && typeof el.scount != 'undefined' && (el.scount<parseInt(filter.sat_from, 10) || el.scount == '---')){
					return false;
				}
				if(filter.sat_to && typeof el.scount != 'undefined' && (el.scount>parseInt(filter.sat_to, 10) || el.scount == '---')){
					return false;
				}
				if(filter.speed_from && typeof el.speed != 'undefined' && (el.speed<parseInt(filter.speed_from, 10) || el.speed == '---')){
					return false;
				}
				if(filter.speed_to && typeof el.speed != 'undefined' && (el.speed>parseInt(filter.speed_to, 10) || el.speed == '---')){
					return false;
				}
				return true;
			});
		}
		if(processedmsgs.length ) {
			$("#paginated-table").dividedByPages(processedmsgs, msgsToTable,  function (cPage) { currentPage = cPage;});
			rebindHandlers();
			undisableui();
		} else {
			undisableui();
			disabletableui();
			alert($.localise.tr("No messages meet the specified conditions."));
		}
	}

	/// Transform data message to proper format
	function msgToData (id, msg) {
		var display = "none";
		if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
			display = "inline-block";
		}

		var defValue = "---";
		var mu = getMeasureUnits(cunit);
		var lon = msg.pos ? msg.pos.x : defValue;
		var lat = msg.pos ? msg.pos.y : defValue;
		var speed = msg.pos ? (mu==1 || mu==2) ? Math.round(msg.pos.s / 1.609344) : msg.pos.s : defValue;
		var alt = msg.pos ? (mu==1 || mu==2) ? Math.round(msg.pos.z / 0.3048) : msg.pos.z : defValue;
		var course = msg.pos ? msg.pos.c : defValue;
		var scount = msg.pos ? msg.pos.sc : defValue;
		var loc = defValue;

		var params = defValue;
		for(var i in msg.p) {
			if (params==defValue)
				params = "";
			else
				params += ", ";
			params += i+"="+msg.p[i];
		}

		if(msg.pos) {
			loc = $.localise.tr("Resolving...");
		}

		var data = {
			id: id,
			index: id + 1,
			display: display,
			disabled: (!lastMessage || !lastPosition || msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			t: msg.t,
			speed: speed,
			lat: lat,
			lon: lon,
			alt: alt,
			loc: loc,
			course: course,
			scount: scount,
			idata: (msg.i || msg.i===0) ? msg.i.toString(16) : "-",
			odata: (msg.o || msg.o===0) ? msg.o.toString(16) : "-",
			params: params
		};
		return data;
	}

	/// Transform sms message to proper format
	function msgToSms (id, msg) {
		var display = "none";
		if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
			display = "inline-block";
		}

		var defValue = "---";
		var text = msg.st ? msg.st : defValue;
		var phone = msg.mp ? msg.mp : defValue;

		var data = {
			id: id,
			index: id + 1,
			display: display,
			disabled: (!lastMessage || !lastPosition || msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			t: msg.t,
			text: text,
			phone: phone
		};
		return data;
	}

	/// Transform command message to proper format
	function msgToCommand (id, msg) {
		var display = "none";
		if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
			display = "inline-block";
		}

		var defValue = "---";
		var cname = msg.ca ? msg.ca : defValue;
		var ctype = msg.cn ? $.localise.tr(msg.cn) : defValue;

		if (msg.cn == "block_engine")
			ctype = $.localise.tr("block engine");
		else if (msg.cn == "unblock_engine")
			ctype = $.localise.tr("unblock engine");
		else if (msg.cn == "custom_msg")
			ctype = $.localise.tr("custom message");
		else if (msg.cn == "driver_msg")
			ctype = $.localise.tr("message to driver");
		else if (msg.cn == "download_msgs")
			ctype = $.localise.tr("download messages");
		else if (msg.cn == "query_pos")
			ctype = $.localise.tr("query position");
		else if (msg.cn == "query_photo")
			ctype = $.localise.tr("query snapshot");
		else if (msg.cn == "output_on")
			ctype = $.localise.tr("activate output");
		else if (msg.cn == "output_off")
			ctype = $.localise.tr("deactivate output");
		else if (msg.cn == "send_position")
			ctype = $.localise.tr("send coordinates");
		else if (msg.cn == "set_report_interval")
			ctype = $.localise.tr("set data transfer interval");
		else if (msg.cn == "upload_cfg")
			ctype = $.localise.tr("upload configuration");
		else if (msg.cn == "upload_sw")
			ctype = $.localise.tr("upload firmware");

		var cparams = msg.cp ? msg.cp : defValue;
		var user = defValue;
		wialon.core.Session.getInstance().searchItem(msg.ui, wialon.item.Item.dataFlag.base, function(code, item) {
			if (code)
				return;
			$("#msg_"+id+" .user").html(item.getName());
		});
		var channel = defValue;
		if (msg.lt) {
			if(msg.lt == "")
				channel = $.localise.tr("Auto");
			else if (msg.lt == "gsm")
				channel = "SMS";
			else if (msg.lt == "tcp")
				channel = "TCP";
			else if (msg.lt == "udp")
				channel = "UDP";
			else if (msg.lt == "vrt")
				channel = "Virtual";
		}
		var extime = msg.et ? wialon.util.DateTime.formatTime(msg.et, 0, enFormatTime) : defValue;

		var data = {
			id: id,
			index: id + 1,
			display: display,
			disabled: (!lastMessage || !lastPosition || msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			t: msg.t,
			cname: cname,
			ctype: ctype,
			cparams: cparams,
			user: user,
			channel: channel,
			extime: extime,
			ext: msg.et
		};
		return data;
	}

	/// Transform event message to proper format
	function msgToEvent (id, msg) {
		var display = "none";
		if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
			display = "inline-block";
		}

		var type = $.localise.tr("Event");
		if (msg.f & 0x10)
			type = $.localise.tr("Maintenance");
		else if (msg.f & 0x20)
			type = $.localise.tr("Filling");
		else if (msg.f & 0x1)
			type = $.localise.tr("Violation");
		var text = getEventText(msg, cunit);
		var defValue = "---";
		var lon = msg.x ? msg.x : defValue;
		var lat = msg.y ? msg.y : defValue;

		var params = defValue;
		for(var i in msg.p) {
			if (params==defValue)
				params = "";
			else
				params += ", ";
			params += i+"="+msg.p[i];
		}

		var data = {
			id: id,
			index: id + 1,
			display: display,
			disabled: (!lastMessage || !lastPosition || msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			t: msg.t,
			type: type,
			text: text,
			lon: lon,
			lat: lat,
			params: params
		};
		return data;
	}

	// Get event text - parse its parameters
	function getEventText(msg, unit) {
		if (!msg)
			return "---";

		var mu = getMeasureUnits(unit);
		// route message
		if (msg.p && typeof msg.p == "object" && typeof msg.p.rt_code != "undefined") {
			if (msg.p.rt_code == 1)
				return sprintf($.localise.tr("Route '%s': round by schedule '%s' started."), msg.p.rt_name, msg.p.rt_zone);
			else if (msg.p.rt_code == 2)
				return sprintf($.localise.tr("Route '%s': round finished."), msg.p.rt_name);
			else if (msg.p.rt_code == 4)
				return sprintf($.localise.tr("Route '%s': round aborted."), msg.p.rt_name);
			else if (msg.p.rt_code == 8)
				return sprintf($.localise.tr("Route '%s': arrival at point '%s'."), msg.p.rt_name, msg.p.rt_pt_name);
			else if (msg.p.rt_code == 0x10)
				return sprintf($.localise.tr("Route '%s': point '%s' skipped."), msg.p.rt_name, msg.p.rt_pt_name);
			else if (msg.p.rt_code == 0x20)
				return sprintf($.localise.tr("Route '%s': departure from point '%s'."), msg.p.rt_name, msg.p.rt_pt_name);
			else if (msg.p.rt_code == 0x40)
				return sprintf($.localise.tr("Route '%s': unit is late."), msg.p.rt_name);
			else if (msg.p.rt_code == 0x80)
				return sprintf($.localise.tr("Route '%s': unit is ahead of schedule."), msg.p.rt_name);
			else if (msg.p.rt_code == 0x100)
				return sprintf($.localise.tr("Route '%s': unit returned to schedule."), msg.p.rt_name);
			else if (msg.p.rt_code == 21)
				return sprintf($.localise.tr("Route %s: entered %s"), msg.p.rt_name, msg.p.rt_zone);
			else if (msg.p.rt_code == 22)
				return sprintf($.localise.tr("Route %s: left %s"), msg.p.rt_name, msg.p.rt_zone);
		}
		else if (msg.p && typeof msg.p == "object") {
			if (typeof msg.p.prev_bytes_counter != "undefined") {
				if (parseInt(msg.p.reset_bytes_counter))
					return sprintf($.localise.tr("GPRS traffic counter reset. %d KB consumed."), parseInt(msg.p.prev_bytes_counter / 1024));
				else
					return sprintf($.localise.tr("GPRS traffic counter value: %d KB."), parseInt(msg.p.prev_bytes_counter / 1024));
			}
			else if (typeof msg.p.engine_hours != "undefined") {
				if (parseInt(msg.p.reset_engine_hours)) {
					if (typeof msg.p.new_engine_hours != "undefined")
						return sprintf($.localise.tr("Engine hours counter value was changed from %d h to %d h."), parseInt(msg.p.engine_hours / 3600), parseInt(msg.p.new_engine_hours / 3600));
				} else
					return sprintf($.localise.tr("Engine hours counter value is %d h."), parseInt(msg.p.engine_hours / 3600));
			}
			else if (typeof msg.p.mileage != "undefined") {
				if (parseInt(msg.p.reset_mileage)) {
					if (typeof msg.p.new_mileage != "undefined")
						return sprintf( ((mu == 1 || mu == 2)? $.localise.tr("Mileage counter value was changed from %d mi to %d mi.") : $.localise.tr("Mileage counter value was changed from %d km to %d km.")), parseInt(msg.p.mileage / 1000), parseInt(msg.p.new_mileage / 1000));
				} else
					return sprintf( ((mu == 1 || mu == 2)? $.localise.tr("Mileage counter value is %d mi.") : $.localise.tr("Mileage counter value is %d km.")), parseInt(msg.p.mileage / 1000));
			}
		}
		return msg.et;
	}

	/// The auxiliary function for transform msg in row table
	function msgToRow (id, msg) {
		var data = {};
		var tempName = "";

		if(curType == 0x000) {
			data = processedmsgs[id];
			if(data.lon != '---' && data.lat != '---') {
				detectLocation(data.id, data.lon, data.lat);
			}
			tempName = "#data_row";
		} else if (curType == 0x100) {
			data = processedmsgs[id];
			tempName = "#sms_row";
		} else if (curType == 0x200) {
			data = processedmsgs[id];
			tempName = "#command_row";
		} else if (curType == 0x600) {
			data = processedmsgs[id];
			tempName = "#event_row";
		}
		data.tm=wialon.util.DateTime.formatTime(data.t, 0, enFormatTime);
		var template = _.template($(tempName).html());
		return template(data);
	}
	/// Disabled ui
	function disableui () {

		$('#loading').addClass('show');
		disabletableui();
	}
	/// Undisabled ui
	function undisableui () {
		$('#loading').removeClass('show');
		if(msgsCount>0){
			undisabletableui();
		}
	}
	/// Disabled table ui
	function disabletableui () {
		$("#table-instruments").hide();
		$("#paginated-table").hide();
		$("#header-wrap table").hide();
		$(window).trigger("resize");
	}
	/// Undisabled table ui
	function undisabletableui () {
		$("#table-instruments").show();
		$("#paginated-table").show();
		$("#header-wrap table").show();
	};
	/// Callback
	function changeRowOnPage () {
		var rowOnPage = parseInt($(this).val());
		var maxPage = Math.floor(msgsCount/rowOnPage)+1;
		var targetPage = currentPage;
		if (targetPage > maxPage)
			targetPage = maxPage;
		disableui();
		currentPage = targetPage;
		currentRowOnPage = rowOnPage;
		var table = $("#paginated-table");
		table.trigger("changerowonpage", currentRowOnPage);
		undisableui();
	}
	/// Callback
	function changePage (event) {
		if (event.which === 13) {
			var nPage = parseInt($(this).val());
			var pagesCount = parseInt($("#cpages").html());
			if (!$.isNumeric($(this).val()) || nPage<1 || nPage>pagesCount)
				nPage = currentPage;
			disableui();
			currentPage = nPage;
			var table = $("#paginated-table");
			table.trigger("changepage", currentPage);
			if(curType==0x000){
				var msg;
				for(var index in processedmsgs){
					msg = processedmsgs[index];
					detectLocation(msg.id, msg.lon, msg.lat);
				}
			}
			undisableui();
		}
	}
	/// get Measure Units
	function getMeasureUnits (unit) {
		var metric = unit.getMeasureUnits();
		metric = (metric) ? metric : 0; // check for users who have never changed the parameters of the metric
		return metric;
	}
	/// get string of time format
	function getTimeFormat() {
		var s = wialon.core.Session.getInstance();
		var currentUser = s.getCurrUser();
		var tf = '';
		currentUser.getLocale(function(code, locale){
			tf = wialon.util.DateTime.convertFormat(locale.fd, true).replace('_', ' ');
		});

		return '';
	}
	/// A function to execute after the DOM is ready.
	$(document).ready(function () {
		var title = decodeURIComponent(APP_CONFIG.alias || "Messages Manager");
		$("#app_name").html(title);
		document.title = title;

		disabletableui();
		var url = getHtmlParameter("baseUrl","https://hst-api.wialon.com");
		if (!url) {
			url = getHtmlParameter("hostUrl","https://hosting.wialon.com");
		}
		if (!url) {
			return null;
		}
		url += "/wsdk/script/wialon.js" ;

		lang = getHtmlParameter("lang","en");
		if (availableLanguages && $.inArray(lang, availableLanguages) == -1)
			lang = "en";
		if(documentationLink){
			$('#help').html('<a target="_blank" href="' + documentationLink + '"><img src="./img/help.png" height="24" width="24"></a>');
		}


		$.localise('lang/', {language: lang});


		initControls();

		loadScript(url, initSdk);
	});

	/// Fill controls with values
	function initControls () {
		var resize = function(){
			$("#paginated-table").width("100%");
			$("#table-wrap").width("100%");
			$(".table-content").width("100%");

			setTimeout(function() {
				var tableW = $("#paginated-table").width();
				var wrapperW = $("#table-wrap").width();
				var width = tableW>wrapperW ? tableW : wrapperW;

				var tblHeight = $(window).outerHeight()-$("#header").outerHeight()-$("#data-inputs").outerHeight()-$(".table-footer").outerHeight()-$("#header-wrap").outerHeight()-1 - 12;
				$("#table-wrap").height(tblHeight);

				if(resizeTimer)
					return;
				resizeTimer = setTimeout(function(){
					$("#paginated-table tr:eq(0) td").each(function(){
						$(this).triggerHandler("resize");
					});
				},100);
			}, 200);
		};
		resize();
		$(window).resize(resize);

		$("#type_title").html($.localise.tr("Type"));
		$("#filter").attr('title',$.localise.tr("Filter messages"));
		$("#del_btn").html($.localise.tr("Delete"));
		$("#page").html($.localise.tr("Page&nbsp;"));
		$("#of").html($.localise.tr("&nbsp;of&nbsp;"));
		$("#msg_type").append("<option value='0x000'>"+$.localise.tr("Data")+"</option>");
		$("#msg_type").append("<option value='0x100'>SMS</option>");
		$("#msg_type").append("<option value='0x200'>"+$.localise.tr("Command")+"</option>");
		$("#msg_type").append("<option value='0x600'>"+$.localise.tr("Event")+"</option>");
		$("#msg_type").change(clearFilter);
		$("#msg_type").change(execute);
		$("#unit_params").click(showLastParams);
		jQuery("#filter").click(function() {
			if(!jQuery(this).hasClass('disabled')){
				jQuery("#param").val(filter.param || '');
				jQuery("#speed_from").val(filter.speed_from || '');
				jQuery("#speed_to").val(filter.speed_to || '');
				jQuery("#sat_from").val(filter.sat_from || '');
				jQuery("#sat_to").val(filter.sat_to || '');
				jQuery("#filter_dialog").toggle();
			}
		});

		$("body").delegate(".sort", "click", function() {
			var sort_hdr = $(this);
			if(sort_hdr.hasClass('down')){
				$('.up, .down').removeClass('up').removeClass('down');
				sort_hdr.addClass('up');
				reverse = true;
			} else {
				$('.up, .down').removeClass('up').removeClass('down');
				sort_hdr.addClass('down');
				reverse = false;
			}
			var sort_by = function(field, reverse, primer){

				var key = primer ?
				function(x) {return primer(x[field])} :
				function(x) {return x[field]};

				reverse = !reverse ? 1 : -1;

				return function (a, b) {
					return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
				}
			}

			processedmsgs.sort(sort_by(this.id, reverse, false));
			$("#paginated-table").trigger("changepage", currentPage);

		});

		$("#table-wrap").scroll(function(){
			$("#header-wrap").scrollLeft($(this).scrollLeft());
		});

		var t = underi18n.MessageFactory(TRANSLATIONS);
		$('#filter_dialog').html(_.template(underi18n.template($('#filter-tpl').html(), t), {
			LANG: lang
		}));
		jQuery(".modal-overflow").click(function(event) {
			if (event.target == this || jQuery(event.target).hasClass("close")) {
				jQuery("#filter_dialog").toggle();
				if (jQuery(event.target).hasClass("ok")) {
					filter = {
						param:jQuery("#param").val(),
						speed_from:jQuery("#speed_from").val(),
						speed_to:jQuery("#speed_to").val(),
						sat_from:jQuery("#sat_from").val(),
						sat_to:jQuery("#sat_to").val()
					};
					if(filter.param || filter.speed_from || filter.speed_to || filter.sat_from || filter.sat_to){
						jQuery("#filter").addClass('active');
					} else {
						jQuery("#filter").removeClass('active');
					}
					if(msgsCount>0){
						processMsgs();
					}
				}
			}

			if(jQuery(event.target).hasClass("clear")){
				jQuery("#param").val('');
				jQuery("#speed_from").val('');
				jQuery("#speed_to").val('');
				jQuery("#sat_from").val('');
				jQuery("#sat_to").val('');
				return;
			}
		});

		$("#nrowonpage").change(changeRowOnPage);
		$("#page_selector").keypress(changePage);

		$("#del_btn").click(onDelete);

		$("#units-select").change(function() {
			disabletableui();

			var spec = [{
				type: "id",
				data: this.value,
				flags: wialon.item.Item.dataFlag.base|wialon.item.Unit.dataFlag.lastMessage|wialon.item.Unit.dataFlag.messageParams,
				mode: 0
			}];
			wialon.core.Session.getInstance().updateDataFlags(spec, function(code) {
				if (code)
					return;

				// get & set address format for GIS geocoding
				var address_format = wialon.core.Session.getInstance().getCurrUser().getCustomProperty("us_addr_fmt", "");
				if (address_format) {
					var addr_fmt = address_format.split("_");
					if (addr_fmt)
						wialon.util.Gis.geocodingParams = {flags: addr_fmt[0], city_radius: addr_fmt[1], dist_from_unit: addr_fmt[2]};
				}

				cunit = wialon.core.Session.getInstance().getItem($("#units-select").val());
				timeoutExecute();
			});
		});

		$("#last_params").click(function(){
			$(this).hide();
		});

		$("#last_params div").click(function(e){
			e.stopPropagation();
		});
	}

	/// init initDatepicker
	function initDatepicker(firstDay, setDateFormat) {
		$.datepicker.regional.ru = {
			closeText: "Закрыть",
			prevText: "Пред",
			nextText: "След",
			currentText: "Сегодня",
			monthNames: ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"],
			monthNamesShort: ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"],
			dayNames: ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"],
			dayNamesShort: ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"],
			dayNamesMin: ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"],
			weekHeader: "Не",
			dateFormat: "dd.mm.yy",
			firstDay: firstDay,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};
		$.datepicker.regional.sk = {
			closeText: "Zavrieť",
			prevText: "Pred",
			nextText: "Ďaľší",
			currentText: "Dnes",
			monthNames: ["Január","Február","Marec","Apríl","Máj","Jún","Júl","August","September","Október","November","December"],
			monthNamesShort: ["Jan","Feb","Mar","Apr","Máj","Jún","Júl","Aug","Sep","Okt","Nov","Dec"],
			dayNames: ["Nedeľa","Pondelok","Utorok","Streda","Štvrtok","Piatok","Sobota"],
			dayNamesShort: ["Ned","Pon","Uto","Str","Štv","Pia","Sob"],
			dayNamesMin: ["Ne","Po","Ut","St","Št","Pia","So"],
			weekHeader: "Ty",
			dateFormat: "dd.mm.yy",
			firstDay: firstDay,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};
		$.datepicker.regional.ee = {
			closeText: "Sulge",
			prevText: "&laquo;",
			nextText: "&raquo;",
			currentText: "Täna",
			monthNames: ["Jaanuar","Veebruar","Märts","Aprill","Mai","Juuni","Juuli","August","September","Oktoober","November","Detsember"],
			monthNamesShort: ["Jaan", "Veebr", "Märts", "Apr", "Mai", "Juuni","Juuli", "Aug", "Sept", "Okt", "Nov", "Dets"],
			dayNames: ["Pühapäev", "Esmaspäev", "Teisipäev", "Kolmapäev", "Neljapäev", "Reede", "Laupäev"],
			dayNamesShort: ["Pühap", "Esmasp", "Teisip", "Kolmap", "Neljap", "Reede", "Laup"],
			dayNamesMin: ["P","E","T","K","N","R","L"],
			weekHeader: "Sm",
			dateFormat: "dd.mm.yy",
			firstDay: 1,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};
		$.datepicker.regional.fi = {
			closeText: "Sulje",
			prevText: "&laquo;",
			nextText: "&raquo;",
			currentText: "T&auml;n&auml;&auml;n",
			monthNames: ["Tammikuu","Helmikuu","Maaliskuu","Huhtikuu","Toukokuu","Kes&auml;kuu","Hein&auml;kuu","Elokuu","Syyskuu","Lokakuu","Marraskuu","Joulukuu"],
			monthNamesShort: ["Tammi","Helmi","Maalis","Huhti","Touko","Kes&auml;","Hein&auml;","Elo","Syys","Loka","Marras","Joulu"],
			dayNamesShort: ["Su","Ma","Ti","Ke","To","Pe","Su"],
			dayNames: ["Sunnuntai","Maanantai","Tiistai","Keskiviikko","Torstai","Perjantai","Lauantai"],
			dayNamesMin: ["Su","Ma","Ti","Ke","To","Pe","La"],
			weekHeader: "Vk",
			dateFormat: "dd.mm.yy",
			firstDay: 1,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};

		$.datepicker.regional.es = {
			closeText: "Cerrar",
			prevText: "&#x3c;Ant",
			nextText: "Sig&#x3e;",
			currentText: "Hoy",
			monthNames: ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
			"Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],
			monthNamesShort: ["Ene","Feb","Mar","Abr","May","Jun",
			"Jul","Ago","Sep","Oct","Nov","Dic"],
			dayNames: ["Domingo","Lunes","Martes","Mi&eacute;rcoles","Jueves","Viernes","S&aacute;bado"],
			dayNamesShort: ["Dom","Lun","Mar","Mi&eacute;","Juv","Vie","S&aacute;b"],
			dayNamesMin: ["Do","Lu","Ma","Mi","Ju","Vi","S&aacute;"],
			weekHeader: "Sm",
			dateFormat: "dd/mm/yy",
			firstDay: 1,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};

		$.datepicker.regional.lv = {
			closeText: "Aizvērt",
			prevText: "Iepr",
			nextText: "Nāka",
			currentText: "Šodien",
			monthNames: [
				"Janvāris","Februāris","Marts","Aprīlis","Maijs","Jūnijs",
				"Jūlijs","Augusts","Septembris","Oktobris","Novembris","Decembris"
			],
			monthNamesShort: ["Jan","Feb","Mar","Apr","Mai","Jūn","Jūl","Aug","Sep","Okt","Nov","Dec"],
			dayNames: ["svētdiena","pirmdiena","otrdiena","trešdiena","ceturtdiena","piektdiena","sestdiena"],
			dayNamesShort: ["svt","prm","otr","tre","ctr","pkt","sst"],
			dayNamesMin: ["Sv","Pr","Ot","Tr","Ct","Pk","Ss"],
			weekHeader: "Nav",
			dateFormat: "dd-mm-yy",
			firstDay: 1,
			isRTL: false,
			showMonthAfterYear: false,
			yearSuffix: ""
		};

		$.datepicker.regional["hu"] = {
			closeText: "bezár",
			prevText: "vissza",
			nextText: "előre",
			currentText: "ma",
			monthNames: [
				"Január", "Február", "Március", "Április", "Május", "Június",
				"Július", "Augusztus", "Szeptember", "Október", "November", "December"
			],
			monthNamesShort: ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szep", "Okt", "Nov", "Dec"],
			dayNames: ["Vasárnap", "Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat"],
			dayNamesShort: ["Vas", "Hét", "Ked", "Sze", "Csü", "Pén", "Szo"],
			dayNamesMin: ["V", "H", "K", "Sze", "Cs", "P", "Szo"],
			weekHeader: "Hét",
			dateFormat: "yy.mm.dd.",
			firstDay: 1,
			isRTL: false,
			showMonthAfterYear: true,
			yearSuffix: ""
		};
		$.datepicker.setDefaults($.datepicker.regional[lang]);
		var options = {
			template: $('#ranging-time-tpl').html(),
			labels: {
				yesterday: $.localise.tr("Yesterday"),
				today: $.localise.tr("Today"),
				week: $.localise.tr("Week"),
				month: $.localise.tr("Month"),
				custom: $.localise.tr("Custom"),
				ok: "OK"
			},
			datepicker: {},
			onInit: function(){
				$("#ranging-time-wrap").intervalWialon('set', 0);
			},
			onChange: function(data){
				changeTime.apply(this, data);
			},
			onAfterClick: function () {
				$(".date-time-content").resize();
			},
			tzOffset: wialon.util.DateTime.getTimezoneOffset() + wialon.util.DateTime.getDSTOffset(),
			now: wialon.core.Session.getInstance().getServerTime(),
		};

		options.dateFormat = wialon.util.DateTime.convertFormat(setDateFormat.split('_')[0], true);
		options.firstDay = firstDay;

		$("#ranging-time-wrap").intervalWialon(options);
	}
	function timeoutExecute() {
		disableui();
		if (changeTimeTimeout !== null) {
			clearTimeout(changeTimeTimeout);
		}
		changeTimeTimeout = setTimeout(function() {
			execute();
			clearTimeout(changeTimeTimeout);
			changeTimeTimeout = null;
		}, 1000);
	}
	/// changeTime
	function changeTime(value, interval){
		if( ! interval)
			return ;
		value = parseInt(value, 10);
		if (value == 4 && LOCAL_STATE.time_custom === null) {
			LOCAL_STATE.time_custom = interval;
		}
		LOCAL_STATE.time_type = value;

		timeoutExecute();

		activateTimeTemplate(value);
	}

	/** Activate interval time ( buttons, labels, timepickers... )
	 *
	 *  @param {int} value   type of interval. Possible values: @see changeTime
	 *  @returns {bool}   true - done without errors, false - activation failed
	 */
	function activateTimeTemplate(value) {
		$("#time-select .time-template.active").removeClass("active");

		var obj = $("#time_" + value);
		if (!obj && !obj.length) return false;

		if (value === 0 || value === 1) {
			if ((LOCAL_STATE.time_from == TODAY.from - 86400 && LOCAL_STATE.time_to == TODAY.to - 86400 * 2 + 1) ||
				(LOCAL_STATE.time_from == TODAY.from && LOCAL_STATE.time_to == TODAY.to - 86399)) {
				obj.addClass("active");
			}
		} else {
			obj.addClass("active");
		}


		$(".date-time-content").resize();
		return true;
	}

	/// Show latest parameters
	function showLastParams() {
		$("#params_table").html("");
		wialon.core.Session.getInstance().searchItem($("#units-select").val(), wialon.item.Item.dataFlag.base|wialon.item.Unit.dataFlag.messageParams, function(code, item) {
			if(code)
				return;

			var topOffset = $("#unit_params").offset().top;
			var leftOffset = $("#unit_params").offset().left;
			var topDelta = $("#unit_params").height()+3;
			$("#last_params div").css("top",topOffset+topDelta);
			$("#last_params div").css("left",leftOffset);
			$("#last_params div").css("max-height",$(window).outerHeight()-topOffset-topDelta);
			$("#last_params").show();

			var lastParams = item.getMessageParams();
			if (wialon.util.Json.compareObjects(lastParams, {})) {
				$("#params_table").append("<tr><td>"+$.localise.tr("No available parameters")+"</td></tr>");
				return;
			}

			$("#params_table").append("<tr><td colspan=2 class='caption'>"+$.localise.tr("Latest parameters")+"</td></tr>");
			var addRow = function(name, value) {
				if(!name || typeof(value) == "undefined")
					return;
				var html = "<tr><td class='title'>"+ name + "</td><td>"+ value + "</td></tr>";
				$("#params_table").append(html);

				var clientWidth = $("#last_params div")[0].clientWidth;
				var scrollWidth =  $("#last_params div")[0].scrollWidth;
				if (clientWidth != scrollWidth)
					$("#last_params div").width(scrollWidth);
			};
			var mu = getMeasureUnits(item);
			if (lastParams["posinfo"]) {
				addRow($.localise.tr("Longitude"), lastParams["posinfo"].v.x);
				addRow($.localise.tr("Latitude"), lastParams["posinfo"].v.y);
				addRow(
					$.localise.tr("Altitude"),
					lastParams["posinfo"].v.z
						? ( (mu == 1 || mu == 2) ? (lastParams["posinfo"].v.z * 3.281) : lastParams["posinfo"].v.z ) + " " + ( (mu == 1 || mu == 2) ? ($.localise.tr("ft")) : $.localise.tr("m"))
						: '---'
				);
				addRow($.localise.tr("Course"), lastParams["posinfo"].v.c);
				addRow($.localise.tr("Satellites"), lastParams["posinfo"].v.sc);
			}
			if(lastParams["speed"])
				addRow($.localise.tr("Speed"), ( (mu == 1 || mu == 2) ? ( Math.round(lastParams["speed"].v / 1.609344) ) : lastParams["speed"].v ) + " " + ( (mu == 1 || mu == 2) ? $.localise.tr("mph") : $.localise.tr("km/h") ));
			var idata = "-";
			if (lastParams["in"] && (lastParams["in"].v || lastParams["in"].v === 0) )
				idata = lastParams["in"].v.toString(16);
			var odata = "-";
			if (lastParams["out"] && (lastParams["out"].v || lastParams["out"].v === 0))
				odata = lastParams["out"].v.toString(16);
			if(lastParams["in"] || lastParams["out"])
				addRow($.localise.tr("I/O"),idata+"/"+ odata);

			for(var i in lastParams) {
				if (i!="speed" && i!="in" && i!="out" && i!="posinfo")
					addRow(i,lastParams[i].v);
			}
		});
	}

	/// Detect location
	function detectLocation (id, lon, lat) {
		locationsData[id] = {
			lon: lon,
			lat: lat,
			st: false
		};
		if (timerId)
			return;
		timerId = setTimeout(process, 1000);
	}

	/// Make request to detect locations
	function process() {
		if (timerId) {
			clearTimeout(timerId);
			timerId = 0;
		}
		if (locationsData && !inProgress) {
			inProgress = true;
			var ids = [];
			var coords = [];
			var delIds = [];

			for (var id in locationsData) {
				var loc = locationsData[id];
				if (typeof loc == "undefined" || !loc || loc.st) {
					delIds.push(id);
					continue;
				}
				// mark as in progress
				loc.st = true;

				coords.push({
					lat: loc.lat,
					lon: loc.lon
				});

				ids.push(id);
			}
			// delete
			for (var i = 0; i < delIds.length; i++) {
				var id = delIds[i];
				if (typeof locationsData[id] != "undefined") {
					delete locationsData[id];
				}
			}

			if (coords.length) {
				wialon.util.Gis.getLocations(coords, qx.lang.Function.bind(function(ids, code, locations) {
					if (!code) {
						inProgress = false;
						if (locations && ids && locations.length == ids.length) {
							for (var i = 0; i < locations.length && i < ids.length; i++)
								updateLocationCallback(ids[i], locations[i]);
							$("#msg_0 .location").trigger("resize");
							$(window).resize();
						}
					}
				}, this, ids));
			} else {
				inProgress = false;
			}
		}
	}

	/// Callback for detecting location
	function updateLocationCallback(id, location) {
		$("#msg_"+id+" .location").html(location);
	}

	/// set Locale Date Time
	function setLocaleDateTime () {
		var days = [
				$.localise.tr("Sunday"),
				$.localise.tr("Monday"),
				$.localise.tr("Tuesday"),
				$.localise.tr("Wednesday"),
				$.localise.tr("Thursday"),
				$.localise.tr("Friday"),
				$.localise.tr("Saturday")
			],
			months = [
				$.localise.tr("January"),
				$.localise.tr("February"),
				$.localise.tr("March"),
				$.localise.tr("April"),
				$.localise.tr("May"),
				$.localise.tr("June"),
				$.localise.tr("July"),
				$.localise.tr("August"),
				$.localise.tr("September"),
				$.localise.tr("October"),
				$.localise.tr("November"),
				$.localise.tr("December")
			],
			days_abbrev = [
				$.localise.tr("Sun"),
				$.localise.tr("Mon"),
				$.localise.tr("Tue"),
				$.localise.tr("Wed"),
				$.localise.tr("Thu"),
				$.localise.tr("Fri"),
				$.localise.tr("Sat")
			],
			months_abbrev = [
				$.localise.tr("Jan"),
				$.localise.tr("Feb"),
				$.localise.tr("Mar"),
				$.localise.tr("Apr"),
				$.localise.tr("May"),
				$.localise.tr("Jun"),
				$.localise.tr("Jul"),
				$.localise.tr("Aug"),
				$.localise.tr("Sep"),
				$.localise.tr("Oct"),
				$.localise.tr("Nov"),
				$.localise.tr("Dec")
			];
		wialon.util.DateTime.setLocale(days, months, days_abbrev, months_abbrev);
	}

}) ( jQuery , _);
