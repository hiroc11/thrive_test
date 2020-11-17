import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'registration_screen.dart';
import 'package:firebase_core/firebase_core.dart';


class ProfileScreen extends StatefulWidget {
  static const String id ='profile_screen';
  @override
  _ProfileScreenState createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _auth=FirebaseAuth.instance;
  User loggedinUser;

  void getCurrentUser() async{
    try{
    final user= await _auth.currentUser;
    if (user !=null){
      loggedinUser = user;
      print(loggedinUser.email);
    }
  }catch (e){
    print(e);
  }
}

  Widget build(BuildContext context) {
  return MaterialApp(
  debugShowCheckedModeBanner: false,
  home: Scaffold(

  bottomNavigationBar: BottomNavigationBar(
  items: const<BottomNavigationBarItem>[
  BottomNavigationBarItem(
  icon:Icon(Icons.home),
  title:Text('Home'),
  ),
  BottomNavigationBarItem(
  icon: Icon(Icons.home),
  title:Text('Home'),
  )
  ],
  ),
  body: SafeArea(
  child: Column(
  children: [
  Container(
  height: (800.0),
  padding: const EdgeInsets.all(20.0),
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white,
  blurRadius: 30.0,
  )
  ],
  color: Colors.black12,),
  child: SingleChildScrollView(
  child:Column(

  children: [
  SizedBox(
  height: 10,
  ),
  Row(
  children: [
  CircleAvatar(
  backgroundImage: AssetImage('images/yoichi.jpg'),
  radius: 50.0,
  ),
  SizedBox(
  width: 80,
  ),
  Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  children: [
  Text(
  'Yoichi',
  style: TextStyle(
  color: Colors.black,
  fontWeight: FontWeight.bold,
  fontSize: 20,
  ),
  ),
  Text(
  '@ychssk725',
  style: TextStyle(
  color: Colors.blueGrey[900],
  fontSize: 15,
  ),
  ),
  ],
  ),
  ],
  ),
  SizedBox(
  height: 10,
  ),
  Row(
  crossAxisAlignment: CrossAxisAlignment.start,
  mainAxisAlignment: MainAxisAlignment.spaceBetween,
  children: [
  FlatButton(
  shape: RoundedRectangleBorder(
  side: BorderSide(
  color: Colors.white,
  ),
  borderRadius: BorderRadius.circular(35),
  ),
  color: Colors.white,
  onPressed: () {
  print('Button pressed');
  },
  child: Text('Edit Profile'),
  ),
  SizedBox(
  width: 40,
  ),
  Column(
  children: [
  Text(
  '85',
  style: TextStyle(
  fontWeight: FontWeight.bold, fontSize: 20),
  ),
  Text(
  'posts',
  style: TextStyle(fontSize: 15),
  ),
  ],
  ),
  Column(
  children: [
  Text(
  '250',
  style: TextStyle(
  fontWeight: FontWeight.bold, fontSize: 20),
  ),
  Text(
  'following',
  style: TextStyle(fontSize: 15),
  ),
  ],
  ),
  Column(
  children: [
  Text(
  '201',
  style: TextStyle(
  fontWeight: FontWeight.bold, fontSize: 20),
  ),
  Text(
  'followers',
  style: TextStyle(fontSize: 15),
  ),
  ],
  ),
  ],
  ),
  SizedBox(
  height: 30,
  ),
  Row(
  children: [
  Text(
  '"Progress, not perfection."',
  style: TextStyle(
  color: Colors.blueGrey[900],
  fontSize: 15,
  ),
  ),
  ],
  ),
  Row(
  children: [
  Text(
  'Trying to be a better version of myself everyday.',
  style: TextStyle(
  color: Colors.blueGrey[900],
  fontSize: 15,
  ),
  ),
  ],
  ),
  SizedBox(
  height: 50,
  ),
  Row(
  mainAxisAlignment: MainAxisAlignment.center,
  children: [

  Container(
  padding: EdgeInsets.only(left: 20.0),
  child: Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  mainAxisAlignment: MainAxisAlignment.end,
  children: <Widget>[
  Text('Surfing', style: TextStyle(
  fontSize: 20, fontWeight: FontWeight.bold)),
  Text('2h3min 40Posts', style: TextStyle(color: Colors.redAccent),),
  ],
  ),
  height: (255.0),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],


  color: Colors.white,),

  ),

  Container(
  height: (255.0),
  child: new Container(
  decoration: new BoxDecoration(
  image: new DecorationImage(
  fit: BoxFit.fitWidth,
  alignment: FractionalOffset.topCenter,
  image: new NetworkImage('https://www.gqrgm.com/wp-content/uploads/2019/09/2.-Blog-Banner-Template.jpg')
  )
  ),
  ),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],
  color: Colors.white,),
  ),
  ],
  ),
  SizedBox(
  height: 10,
  ),
  Row(
  mainAxisAlignment: MainAxisAlignment.center,
  children: [
  Row(
  children: [
  Container(
  padding: EdgeInsets.only(left: 20.0),
  child: Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  mainAxisAlignment: MainAxisAlignment.end,
  children: <Widget>[
  Text('Reading', style: TextStyle(
  fontSize: 20, fontWeight: FontWeight.bold)),
  Text('2h3min 40Posts', style: TextStyle(color: Colors.redAccent),),
  ],
  ),
  height: (255.0),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],


  color: Colors.white,),

  ),

  Container(
  height: (255.0),
  child: new Container(
  decoration: new BoxDecoration(
  image: new DecorationImage(
  fit: BoxFit.fitWidth,
  alignment: FractionalOffset.topCenter,
  image: new NetworkImage('https://thebogotapost.com/wp-content/uploads/2017/06/636052464065850579-137719760_flyer-image-1.jpg')
  )
  ),
  ),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],
  color: Colors.white,),
  ),
  ],
  ),
  ],
  ),
  SizedBox(
  height: 10,
  ),
  Row(
  mainAxisAlignment: MainAxisAlignment.center,
  children: [
  Container(
  padding: EdgeInsets.only(left: 20.0),
  child: Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  mainAxisAlignment: MainAxisAlignment.end,
  children: <Widget>[
  Text('Movie', style: TextStyle(
  fontSize: 20, fontWeight: FontWeight.bold)),
  Text('2h3min 40Posts', style: TextStyle(color: Colors.redAccent),),
  ],
  ),
  height: (255.0),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],


  color: Colors.white,),

  ),
  Container(
  height: (255.0),
  child: new Container(
  decoration: new BoxDecoration(
  image: new DecorationImage(
  fit: BoxFit.fitWidth,
  alignment: FractionalOffset.topCenter,
  image: new NetworkImage('https://s3-us-west-2.amazonaws.com/flx-editorial-wordpress/wp-content/uploads/2019/09/01093013/Endgame-Lead-1.jpg')
  )
  ),
  ),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],
  color: Colors.white,),
  ),
  ],
  ),
  SizedBox(
  height: 10,
  ),
  Row(
  mainAxisAlignment: MainAxisAlignment.center,
  children: [
  Container(
  padding: EdgeInsets.only(left: 20.0),
  child: Column(
  crossAxisAlignment: CrossAxisAlignment.start,
  mainAxisAlignment: MainAxisAlignment.end,
  children: <Widget>[
  Text('Surfing', style: TextStyle(
  fontSize: 20, fontWeight: FontWeight.bold)),
  Text('2h3min 40Posts', style: TextStyle(color: Colors.redAccent),),
  ],
  ),
  height: (255.0),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],


  color: Colors.white,),

  ),
  Container(
  height: (255.0),
  child: new Container(
  decoration: new BoxDecoration(
  image: new DecorationImage(
  fit: BoxFit.fitWidth,
  alignment: FractionalOffset.topCenter,
  image: new NetworkImage('https://cdn-ak.f.st-hatena.com/images/fotolife/A/Andy_Hiroyuki/20170520/20170520063938.jpg')
  )
  ),
  ),
  width: 150.0,
  decoration: BoxDecoration(
  boxShadow: <BoxShadow>[
  BoxShadow(
  color: Colors.white70,
  blurRadius: 30.0,
  ),
  ],
  color: Colors.white,),
  ),
  ],
  ),
  ],
  ),
  )
  ),
  ],
  ),
  ),
  ),
  );
  }
}