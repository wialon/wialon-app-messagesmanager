/// Override "Today" button to also grab the wialon time.
$.datepicker._gotoToday = function(id) {
	var inst = this._getInst($(id)[0]);
	$dp = inst.dpDiv;
	this._base_gotoToday(id);
	var now = new Date();
	var time = wialon.core.Session.getInstance().getServerTime();
	var utime = wialon.util.DateTime.userTime(time * 1000);
	now.setTime(utime);
	this._setTime(inst, now);
	$(".ui-datepicker-today", $dp).click();
};

/// Russian localization for datepicker
$.datepicker.regional["ru"] = { 
	closeText: "Закрыть", 
	prevText: "&#x3c;Пред", 
	nextText: "След&#x3e;", 
	currentText: "Сегодня", 
	monthNames: ["Январь","Февраль","Март","Апрель","Май","Июнь", 
	"Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"], 
	monthNamesShort: ["Янв","Фев","Мар","Апр","Май","Июн", 
	"Июл","Авг","Сен","Окт","Ноя","Дек"], 
	dayNames: ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"], 
	dayNamesShort: ["вск","пнд","втр","срд","чтв","птн","сбт"], 
	dayNamesMin: ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"], 
	dateFormat: "dd MM yy", 
	firstDay: 1,
	timeSuffix: "",
	timeOnlyTitle: "Выберите время",
	timeText: "Время",
	hourText: "Часы",
	minuteText: "Минуты",
	secondText: "Секунды",
	millisecText: "Миллисекунды",
	timezoneText: "Часовой пояс",
	isRTL: false
};

/// Global event handlers
var callbacks = {};
/// Execute callback
function execCallback(id) {
	if (!callbacks[id])
		return null;
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
	var enFormatTime = "HH:mm:ss&nbsp;&nbsp;dd.MM.Y";
	/// Locations cache
	var locationsData = {};
	/// Timer for detecting locations request
	var timerId = 0;
	/// Flag to indicate wether detecting of locations is in progress
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
	/// Fetch varable from 'GET' request
	var getHtmlParameter = _.memoize(function (name) {
		if (!name) {
			return null;
		}
		var pairs = decodeURIComponent(document.location.search.substr(1)).split("&");
		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split("=");
			if (pair[0] === name) {
				pair.splice(0, 1);
				return pair.join("=");
			}
		}
		return null;
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
			$("#table-wrap").activity(false);
			if (code || !data || !data.items || !data.items.length) 
				return;	
			fillUnitsSelect(data.items);
			$("#execute_btn").removeAttr("disabled");
		});
		
	}
	/// Init SDK
	function initSdk() {
		var url = getHtmlParameter("baseUrl");
		if (!url) {
			url = getHtmlParameter("hostUrl");
		}
		if (!url) {
			return null;
		}
		
		var user = getHtmlParameter("user");
		if(!user)
			return null;
		
		wialon.core.Session.getInstance().initSession(url,"",0x800);
		wialon.core.Session.getInstance().duplicate(getHtmlParameter("sid"), user, true, login);
		mloader = wialon.core.Session.getInstance().getMessagesLoader();
	}	
	
	/// Fetches time from the user input
	function getTimeFromInput () {
		var dateFrom = $("#date-from").datetimepicker( "getDate" );
		var dateTo = $("#date-to").datetimepicker( "getDate" );
		if (!dateFrom || !dateTo) {
			return [];
		}

		var timeFrom = Math.round(dateFrom.getTime() / 1000);
		var timeTo = Math.round(dateTo.getTime() / 1000);
		return [timeFrom, timeTo];
	}
	
	/// Show button click handler
	function execute (event) {
		if (!cunit) 
			return;
		
		lastMessage = cunit.getLastMessage();
		lastPosition = cunit.getPosition();
		curType = parseInt($("#msg_type").val());
		currentPage = 1;
		
		disableui();
		
		var times = getTimeFromInput();
		if (!times) 
			return;
		
		ctimes = times; // stores current worker time in global variable
		
		$("#paginated-table").width("100%");
		loadMsgs();
		//$(window).resize();
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
				
				if (curType ==  0x000) {
					data = {
						display: display,
						tm: $.localise.tr("Time"),
						lon: $.localise.tr("Longitude"),
						lat: $.localise.tr("Latitude"),
						alt: $.localise.tr("Altitude, m"),
						loc: $.localise.tr("Location"),
						speed: $.localise.tr("Speed, km/h"),
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
					
				$("#header-wrap").css("display","block");
				$("#header-wrap thead").html(template(data));
				$("#check_all").click(function() {
					$("#paginated-table input:enabled").attr("checked",this.checked);
					$("#del_btn").attr("disabled",!this.checked);
				});
				
				msgsCount = messages.count;
				msgs[msgsCount-1] = null;
				$("#paginated-table").dividedByPages(msgs, msgsToTable);
				rebindHandlers();
				
				if (!$.isNumeric(currentPage)  || currentPage < 1 || currentPage > parseInt($("#cpages").html()) )
					currentPage = 1;
				
				getMsgs(0, currentPage, currentRowOnPage, currentRowOnPage, qx.lang.Function.bind(function () {
					$("#paginated-table").trigger("changepage", currentPage);
					undisableui();
				}));
			} else {
				$("#header-wrap").css("display","none");
				$("#table-wrap").activity(false);
				$("#execute_btn").removeAttr("disabled");
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
	
	/// Rebind handelers for next and previous buttons 
	function rebindHandlers() {
		var events = {};
		rebindHandler("next",jQuery._data($("#next")[0], "events"));
		rebindHandler("prev",jQuery._data($("#prev")[0], "events"));
		rebindHandler("last",jQuery._data($("#last")[0], "events"));
		rebindHandler("top",jQuery._data($("#top")[0], "events"));
	}
	
	/// Rebind handeler for next and previous buttons 
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
				getMsgs(currentPage, targetPage, currentRowOnPage, currentRowOnPage, qx.lang.Function.bind(function() {
					currentPage = targetPage;
					eventHandler();
					undisableui()
				}));
			});
		}
	}
	
	/// Create html table for msg data
	function msgsToTable (sindex, messages) {
		$("#del_btn").attr("disabled",true);
		$("#check_all").attr("checked",false);
		//disableui();
		
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
		//undisableui();
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
	
	/// Transform data message to proper format
	function msgToData (id, msg) {
		var display = "none";
		if (cunit.getUserAccess() & wialon.item.Unit.accessFlag.deleteMessages) {
			display = "inline-block";
		}
		
		var defValue = "---";
		var lon = msg.pos ? msg.pos.x : defValue;
		var lat = msg.pos ? msg.pos.y : defValue;
		var speed = msg.pos ? msg.pos.s : defValue;
		var alt = msg.pos ? msg.pos.z : defValue;
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
			detectLocation(id, lon, lat);
			loc = $.localise.tr("Resolving...");
		}
		
		var data = {
			id: id,
			index: id + 1,
			display: display,
			disabled: (msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			tm: wialon.util.DateTime.formatTime(msg.t, 0, enFormatTime),
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
			disabled: (msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			tm: wialon.util.DateTime.formatTime(msg.t, 0, enFormatTime),
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
			disabled: (msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			tm: wialon.util.DateTime.formatTime(msg.t, 0, enFormatTime),
			cname: cname, 
			ctype: ctype, 	
			cparams: cparams,
			user: user,
			channel: channel,
			extime: extime
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
		var text = getEventText(msg);
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
			disabled: (msg.t == lastMessage.t || msg.t == lastPosition.t) ? "disabled" : "",
			tm: wialon.util.DateTime.formatTime(msg.t, 0, enFormatTime),
			type: type,
			text: text,
			lon: lon,
			lat: lat,
			params: params 
		};
		return data;
	}
	
	// Get event text - parse its patameters
	function getEventText(msg) {
		if (!msg)
			return "---";
		
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
						return sprintf($.localise.tr("Mileage counter value was changed from %d km to %d km."), parseInt(msg.p.mileage / 1000), parseInt(msg.p.new_mileage / 1000));
				} else
					return sprintf($.localise.tr("Mileage counter value is %d km."), parseInt(msg.p.mileage / 1000));
			}
		}
		return msg.et;
	}
	
	/// The auxiliary function for transform msg in row table
	function msgToRow (id, msg) {
		var data = {};
		var tempName = "";
		
		if(curType == 0x000) {
			data = msgToData(id, msg);
			tempName = "#data_row";
		} else if (curType == 0x100) {
			data = msgToSms(id, msg);
			tempName = "#sms_row";
		} else if (curType == 0x200) {
			data = msgToCommand(id, msg);
			tempName = "#command_row";
		} else if (curType == 0x600) {
			data = msgToEvent(id, msg);
			tempName = "#event_row";
		}
		var template = _.template($(tempName).html());
		return template(data);
	}
	/// Disabled ui
	function disableui () {
		try { $("#table-wrap").activity(); } catch (e) {}
		$("#execute_btn").attr("disabled", "disabled");
		disabletableui();
	}
	/// Undisabled ui
	function undisableui () {
		try { $("#table-wrap").activity(false); } catch (e) {} 
		$("#execute_btn").removeAttr("disabled");
		undisabletableui();
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
		getMsgs(currentPage, targetPage, currentRowOnPage, rowOnPage, qx.lang.Function.bind(function () {
			currentPage = targetPage;
			currentRowOnPage = rowOnPage;
			var table = $("#paginated-table");
			table.trigger("changerowonpage", currentRowOnPage);
			undisableui();
		}));
	}
	/// Callback
	function changePage (event) {
		if (event.which === 13) {
			var nPage = parseInt($(this).val());
			var pagesCount = parseInt($("#cpages").html());
			if (!$.isNumeric($(this).val()) || nPage<1 || nPage>pagesCount)
				nPage = currentPage;
			disableui();
			getMsgs(currentPage, nPage, currentRowOnPage, currentRowOnPage, qx.lang.Function.bind(function () {
				currentPage = nPage;
				var table = $("#paginated-table");
				table.trigger("changepage", currentPage);
				undisableui();
			}));
		}
	}
	/// A function to execute after the DOM is ready.
	$(document).ready(function () {
		disabletableui();
		var url = getHtmlParameter("baseUrl");
		if (!url) {
			url = getHtmlParameter("hostUrl");
		}
		if (!url) {
			return null;
		}
		url += "/wsdk/script/wialon.js" ;
		
		var lang = getHtmlParameter("lang");
		if ((!lang) || ($.inArray(lang, ["en", "ru"]) == -1))
			lang = "en";
		$.localise('lang/', {language: lang});
		initControls();	
		
		loadScript(url, initSdk);
	});
	
	/// Fill controls with values
	function initControls () {
		$("#header div").html($.localise.tr("Messages Manager"));
		
		var resize = function(){
			$("#paginated-table").width("100%");
			$("#table-wrap").width("100%");
			$(".table-content").width("100%");
			
			setTimeout(function() {
				var tableW = $("#paginated-table").width();
				var wrapperW = $("#table-wrap").width();
				var width = tableW>wrapperW ? tableW : wrapperW;
				
				$("#header").width(width-17);
				$(".table-content").width(width);
				$(".table-footer").width(width);
				
				var tblHeight = $(window).outerHeight()-$("#header").outerHeight()-$("#data-inputs").outerHeight()-$(".table-footer").outerHeight()-$("#header-wrap").outerHeight()-1;
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
		
		$("#unit_title").html($.localise.tr("Unit"));
		$("#type_title").html($.localise.tr("Type"));
		$("#from_title").html($.localise.tr("From"));
		$("#to_title").html($.localise.tr("To"));
		$("#execute_btn").val($.localise.tr("Show"));
		$("#del_btn").val($.localise.tr("Delete"));
		$("#page").html($.localise.tr("Page&nbsp;"));
		$("#of").html($.localise.tr("&nbsp;of&nbsp;"));
		$("#msg_type").append("<option value='0x000'>"+$.localise.tr("Data")+"</option>");
		$("#msg_type").append("<option value='0x100'>SMS</option>");
		$("#msg_type").append("<option value='0x200'>"+$.localise.tr("Command")+"</option>");
		$("#msg_type").append("<option value='0x600'>"+$.localise.tr("Event")+"</option>");
		$("#unit_params").click(showLastParams);
		
		$("#table-wrap").scroll(function(){
			$("#header-wrap").scrollLeft($(this).scrollLeft());
		});		
				
		var lang = getHtmlParameter("lang");
		if ((!lang) || ($.inArray(lang, ["en", "ru"]) == -1))
			lang = "en";
		
		$.datepicker.setDefaults($.datepicker.regional[lang]);
		$.timepicker.setDefaults($.datepicker.regional[lang]);

		$("#date-from").datetimepicker();
		$("#date-to").datetimepicker();	
		
		var temp = new Date();
		temp.setHours(0);
		temp.setMinutes(0);
		$("#date-from").datetimepicker("setDate", temp);
		temp.setHours(23);
		temp.setMinutes(59);
		$("#date-to").datetimepicker("setDate", temp);

		$("#execute_btn").click(execute);
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
				
				cunit = wialon.core.Session.getInstance().getItem($("#units-select").val());
				
				var lmsgTime = cunit.getLastMessage() ? cunit.getLastMessage().t : "";
				if(lmsgTime) 
					lmsgTime = new Date(parseInt(lmsgTime)*1000);
				else
					lmsgTime = new Date();
				lmsgTime.setHours(0);
				lmsgTime.setMinutes(0);
				$("#date-from").datetimepicker("setDate", lmsgTime);
				lmsgTime.setHours(23);
				lmsgTime.setMinutes(59);
				$("#date-to").datetimepicker("setDate", lmsgTime);
			});
		});
		
		$("#last_params").click(function(){
			$(this).hide();
		});
		
		$("#last_params div").click(function(e){
			e.stopPropagation();
		});
	}
	
	/// Show latest arameters
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
			
			if (lastParams["posinfo"]) {
				addRow($.localise.tr("Longitude"), lastParams["posinfo"].v.x);
				addRow($.localise.tr("Latitude"), lastParams["posinfo"].v.y);
				addRow($.localise.tr("Altitude"), lastParams["posinfo"].v.z + " " + $.localise.tr("m"));
				addRow($.localise.tr("Course"), lastParams["posinfo"].v.c);
				addRow($.localise.tr("Satellites"), lastParams["posinfo"].v.sc);
			}
			if(lastParams["speed"])
				addRow($.localise.tr("Speed"), lastParams["speed"].v + " " + $.localise.tr("km/h"));
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
	
}) ( jQuery , _);